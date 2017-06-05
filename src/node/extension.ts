/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { join, isAbsolute } from 'path';
import * as nls from 'vscode-nls';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as Net from 'net';
import * as cp from 'child_process';
import { bazCode } from './CodeParser';
import { bazForms } from './formCreator';
import * as Registry from 'winreg';

const localize = nls.config(process.env.VSCODE_NLS_CONFIG)();

function addDeclarationFiles() {
	let extensionInfo = vscode.extensions.getExtension('BazisSoft.bazis-debug');
	if (!extensionInfo) {
		return;
	}
	let extensionPath = extensionInfo.extensionPath;
	//add d.ts files to folder
	try {
		let typesPath = join(vscode.workspace.rootPath, '/node_modules/@types/');
		//create directories
		//TODO: find better way, if it exists
		if (!fs.existsSync(join(vscode.workspace.rootPath, '/node_modules'))) {
			fs.mkdirSync(join(vscode.workspace.rootPath, '/node_modules'));
		};
		if (!fs.existsSync(typesPath)) {
			fs.mkdirSync(typesPath);
		};
		if (!fs.existsSync(join(typesPath, '/bazis'))) {
			fs.mkdirSync(join(typesPath, '/bazis'));
		};
		if (!fs.existsSync(join(typesPath, '/node'))) {
			fs.mkdirSync(join(typesPath, '/node'));
		};
		const experimentalRefStr = '/// <reference path="./experimental.d.ts" />';

		let mainFilename = join(typesPath, '/bazis/index.d.ts');
		//check for included experimental declaration
		let experimentalRefIncluded = false;
		if (fs.existsSync(mainFilename)) {
			let prevText = fs.readFileSync(mainFilename).toString();
			let ind = prevText.indexOf(experimentalRefStr);
			experimentalRefIncluded = ind > 0 && prevText[ind - 1] != '/';
		}
		let newDeclarationText = fs.readFileSync(join(extensionPath, '/bazis.d.ts')).toString();
		// include experimental (remove excess slash) if it was included in previous file
		if (experimentalRefIncluded) {
			newDeclarationText = newDeclarationText.replace('/' + experimentalRefStr, experimentalRefStr);
		}
		fs.writeFileSync(join(typesPath, '/bazis/index.d.ts'), newDeclarationText);
		fs.writeFileSync(join(typesPath, '/bazis/experimental.d.ts'), fs.readFileSync(join(extensionPath, '/experimental.d.ts')));
		if (!fs.existsSync(join(typesPath, '/node/index.d.ts'))) {
			fs.writeFileSync(join(typesPath, '/node/index.d.ts'), fs.readFileSync(join(extensionPath, '/node.d.ts')));
		}
	}
	catch (e) {
		//silently ignore
	}
}

interface FileSource {
	fileName: string;
}
class Files<T extends FileSource>{
	SetSource(src: T) {
		this[path.normalize(src.fileName)] = src;
	}
	GetSource(fileName: string): T | undefined {
		let result = this[path.normalize(fileName)];
		return result;
	}
}

let formOpened: boolean = false;
let currentFormName: string | undefined;
let currentFileName: string = '';
let formEditorPath: string = '';
let formEditorProcess: cp.ChildProcess;

/**constants of typ */
const OutMessageType = {
	FormInfo: 'forminfo',
	UpdateInfo: 'update'
}
const InMessageType = {
	NewComponent: 'newcomponent',
	ComponentsChanges: 'componentschanges'
}

const FormEditorFileName = 'FormEditor.exe';

const sourceFiles = new Files<ts.SourceFile>();
let parsedSources = new Files<bazCode.SourceInfo>();
let curTimeout: NodeJS.Timer;
let NeedUpdate = false;
let logDir = vscode.extensions.getExtension('BazisSoft.bazis-debug').extensionPath + '\\';
let sessionLogfile = logDir + 'session.out';
let date = new Date();

//TCP variables
let client = new Net.Socket();
let inData = Buffer.alloc(0);
let inMessageState = 'headers';
let inHeaders = {};


// should be able to change in settings
let parseTimeout = 1500;
let updateOnEnter: boolean = true;
let updateOnSemicolon: boolean = true;
let lastSessionLogging = true;
let loggingDate = true;
let socketPort = 7800;

function CurrentDate(): string {
	return loggingDate ? `${('0' + date.getDate()).slice(-2)}.${('0' + (date.getMonth() + 1)).slice(-2)} ::` : ''
}

function SessionLog(msg: string) {
	if (lastSessionLogging) {
		fs.appendFileSync(sessionLogfile, CurrentDate() + msg + '\n');
	}
}

function logSessionError(error: string): void {
	if (lastSessionLogging) {
		SessionLog('error: ' + error);
	}
}

// it isn't used for now
// function ShowError(error: string): void {
// 	if (logging) {
// 		vscode.window.showErrorMessage(error);
// 	}
// }

function sendMessage(client: Net.Socket, msg: string) {
	if (client && !client.destroyed) {
		const data = 'content-length: ' + Buffer.byteLength(msg, 'utf8') + '\r\n' + msg;
		client.write(data, 'utf8');
	}
}

function RunFormEditor(formInfo?: bazForms.FormChange) {
	if (!formOpened) {
		if (formEditorPath) {
			formEditorProcess = cp.spawn(formEditorPath, ['--port', socketPort.toString()]);
			client.connect(socketPort);

			let connected = false;

			client.on('connect', err => {
				connected = true;
				if (formInfo) {
					ShowFormEditor(formInfo);
				}
				//this._initialize(response);
			});

			const timeout = 10000; //timeout of 10 sec to connect

			const endTime = new Date().getTime() + timeout;
			client.on('error', err => {
				if (connected) {
					// since we are connected this error is fatal
					if (lastSessionLogging)
						logSessionError('Client error:' + (err.stack || ''));
				} else {
					// we are not yet connected so retry a few times
					if ((<any>err).code === 'ECONNREFUSED' || (<any>err).code === 'ECONNRESET') {
						const now = new Date().getTime();
						if (now < endTime) {
							setTimeout(() => {
								client.connect(socketPort);
							}, 200);		// retry after 200 ms
						} else {
							logSessionError(`Cannot connect to runtime process: timeout after ${timeout}`)
						}
					} else {
						logSessionError('Cannot connect to runtime process: error = ' + (<any>err).code);
					}
				}
			});

			client.on("data", (data: Buffer) => {
				SessionLog('In Data: ' + data.toString('utf8'));
				transformInMessage(data);
				return;
			})

			client.on('end', err => {
				if (formEditorProcess)
					formEditorProcess.kill();
				formOpened = false;
				client.removeAllListeners();
				client.destroy();
			});

			formOpened = true;
		}
	}
	else if (formInfo) {
		ShowFormEditor(formInfo);
	}
}

function StringifyCircular(obj): string {
	let cache = <any>[];
	return JSON.stringify(obj, (key, value) => {
		if ((typeof value === 'object') && (value !== null)) {
			if (cache.indexOf(value) !== -1) {
				// Circular reference found, discard key
				let additionalInfo = '';
				if (value instanceof bazCode.ObjectInfo) {
					additionalInfo = value.GetFullName().join('.');
				}
				return `circular${additionalInfo ? ': ' + additionalInfo : ''}`;
			}
			// Store value in our collection
			cache.push(value);
		}
		return value;
	});

	//JSON.stringify(src)
}

function updateSource(src: ts.SourceFile) {
	SessionLog(`Source: ${StringifyCircular(src.statements)}`);
	let parsedSource = bazCode.parseSource(src, logSessionError);
	let oldSource = parsedSources.GetSource(src.fileName);
	parsedSources.SetSource(parsedSource);
	if (oldSource) {
		let formsInfo = bazForms.MakeForms(oldSource, logSessionError);
		if (currentFormName) {
			let form: bazForms.ParsedForm | undefined;
			for (let i = 0; i < formsInfo.length; i++) {
				let info = formsInfo[i];
				if (info.owner + '.' + info.name === currentFormName) {
					form = info;
					break;
				}
			}
			if (form) {
				//old code
				// let updates = bazForms.MakeFormUpdates(form, parsedSource, logSessionError);
				// if (updates)
				// 	UpdateFormEditor(updates);
				let newForms = bazForms.MakeForms(bazCode.parseSource(src, logSessionError), logSessionError);
				let newForm: bazForms.ParsedForm | undefined;
				for (let i = 0; i < newForms.length; i++) {
					let info = newForms[i];
					if (info.owner + '.' + info.name === currentFormName) {
						newForm = info;
						break;
					}
				}
				if (newForm) {
					let updates = bazForms.CompareForms(form, newForm, logSessionError);
					if (updates)
						UpdateFormEditor(updates);
				}
			}
		}
	}
	else {
		let formsInfo = bazForms.MakeForms(parsedSource, logSessionError);
		parsedSources.SetSource(parsedSource);
		if (currentFormName) {
			let form: bazForms.ParsedForm | undefined;
			for (let i = 0; i < formsInfo.length; i++) {
				let info = formsInfo[i];
				if (info.owner + '.' + info.name === currentFormName) {
					form = info;
					break;
				}
			}
			if (form) {
				ShowFormEditor(form);
			}
		}
	}
}

function pushInMessage(msg: string) {

	function MakeTextEdit(doc: vscode.TextDocument, change: bazCode.TextChange): vscode.TextEdit {
		let startPos = doc.positionAt(change.pos);
		let endPos = doc.positionAt(change.end);
		let result = new vscode.TextEdit(
			new vscode.Range(startPos, endPos),
			change.newText
		)
		return result;
	}
	let jsonMsg = JSON.parse(msg);
	let type = jsonMsg['type'];
	let fName = jsonMsg['filename'];
	let parsedSource = parsedSources.GetSource(fName);
	if (!parsedSource)
		throw new Error(`cannot find source ${fName} parsed by codeparser`);
	let message = jsonMsg['message'];
	let doc = vscode.window.activeTextEditor.document;
	let newChanges: vscode.TextEdit[] = [];
	switch (type) {
		case InMessageType.NewComponent: {
			let newChange: bazCode.TextChange | undefined;
			newChange = bazCode.MakeNewComponent(message, parsedSource);
			newChanges.push(MakeTextEdit(doc, newChange));
			break;
		}
		case InMessageType.ComponentsChanges: {
			for (let i = 0; i < message.length; i++) {
				let newChange = bazCode.ChangeProperty(message[i], parsedSource);
				newChanges.push(MakeTextEdit(doc, newChange));
			}
			break;
		}
	}
	if (newChanges.length === 0) {
		logSessionError(`In message cannot be parsed. Full message: ${msg}\n`);
		return;
	}
	else {
		NeedUpdate = true;
	}
	let edit = new vscode.WorkspaceEdit()
	edit.set(doc.uri, newChanges)
	//maybe it will be needed to synchronize data in/out proccess;
	// let version = jsonMsg['version'];
	vscode.workspace.applyEdit(edit);
}

function transformInMessage(data: Buffer) {
	inData = Buffer.concat([inData, data]);

	while (true) {
		if (inMessageState === 'headers') {
			// Not enough data
			if (!inData.includes('\r\n'))
				break;

			var bufString = inData.toString('utf8');
			if ((<any>bufString).startsWith('\r\n')) {
				inData = inData.slice(2);
				inMessageState = 'body';
				continue;
			}

			// Match:
			//   Header-name: header-value\r\n
			var match = bufString.match(/^([^:\s\r\n]+)\s*:\s*([^\s\r\n]+)\r\n/);
			if (!match) {
				logSessionError('Expected header, but failed to parse it');
				return;
			}

			inHeaders[match[1].toLowerCase()] = match[2];

			inData = inData.slice(Buffer.byteLength(match[0], 'utf8'));
		} else {
			var len = inHeaders['content-length'];
			if (len === undefined) {
				logSessionError('Expected content-length');
				return;
			}

			len = len | 0;
			if (Buffer.byteLength(<any>inData, 'utf8') < len)
				break;

			pushInMessage(inData.slice(0, len).toString('utf8'));
			inMessageState = 'headers';
			inData = inData.slice(len);
			inHeaders = {};
		}
	}

}

function ShowFormEditor(form: bazForms.FormChange) {

	let message = {
		type: OutMessageType.FormInfo,
		info: form,
		filename: currentFileName
	}
	let stringMsg = JSON.stringify(message);
	sendMessage(client, stringMsg);
	SessionLog('OutMessage: ' + stringMsg);
}

function UpdateFormEditor(newInfo/*: bazForms.ComponentChanges*/) {
	let message = {
		type: OutMessageType.UpdateInfo,
		info: newInfo,
		filename: currentFileName
	};
	let stringMsg = JSON.stringify(message);
	sendMessage(client, stringMsg);
	SessionLog('OutMessage: ' + stringMsg);

}

function onDidChangeTextDocument(ev: vscode.TextDocumentChangeEvent): void {
	// if (!formOpened)
	// 	return;
	try {
		if (curTimeout)
			clearTimeout(curTimeout);
		let fileName = ev.document.fileName//.replace(/\\/g, '\/');
		let src = <ts.SourceFile>sourceFiles.GetSource(fileName);
		if (!src)
			return;
		ev.contentChanges.forEach(element => {
			let startRange = element.range.start;
			let changeRange: ts.TextChangeRange = {
				span: {
					start: src.getPositionOfLineAndCharacter(startRange.line, startRange.character),
					length: element.rangeLength
				},
				newLength: element.text.length
			}
			let newText = src.getFullText();
			newText = newText.slice(0, changeRange.span.start) + element.text +
				newText.slice(changeRange.span.start + changeRange.span.length);
			src = src.update(newText, changeRange);
			if ((updateOnEnter && element.text.indexOf('\n') > -1) || (updateOnSemicolon && element.text === ';'))
				NeedUpdate = true;
			// fs.appendFileSync('D:\\tmp\\changes.out',
			// 	'---------------------------------------\n' +
			// 	src.getFullText() + `\n --docVersion = ${ev.document.version}\n`);
		});
		sourceFiles.SetSource(src);
		if (NeedUpdate) {
			updateSource(src)
			NeedUpdate = false;
		}
		else
			curTimeout = setTimeout(() => {
				updateSource(src);
			}, parseTimeout);

		// let element = ev.contentChanges[0];
		// src.update(ev.document.getText(), {
		// 	span: {
		// 		start: element.range.start.character,
		// 		length: element.rangeLength
		// 	},
		// 	newLength: element.text.length
		// });
		// fs.appendFileSync('D:\\tmp\\changes.out',
		// 	'---------------------------------------\n' +
		// 	JSON.stringify(src.statements) + `\n docVersion = ${ev.document.version}`);

	}
	catch (e) {
		vscode.window.showErrorMessage(e.message);
		if (curTimeout)
			clearTimeout(curTimeout);
	}
}

function openFormEditor() {
	if (!formEditorPath)
		return;
	try {
		if (lastSessionLogging) {
			fs.writeFileSync(sessionLogfile, '');
		}
		let curDoc = vscode.window.activeTextEditor.document;
		let text = curDoc.getText();
		let fileName = curDoc.fileName//.replace(/\\/g, '\/');
		let src = sourceFiles.GetSource(fileName);
		if (!src) {
			src = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2016, true);
			sourceFiles.SetSource(src);
		}
		let result = bazCode.parseSource(src, logSessionError);
		parsedSources.SetSource(result);
		let forms = bazForms.MakeChanges(undefined, result, logSessionError);
		let formNames: string[] = forms.GetFormNames();
		if (formNames.length > 0) {
			vscode.window.showQuickPick(formNames, {
				placeHolder: 'Выберите имя формы'
			}).then((value: string) => {
				let formInfo = forms.GetFormUpdate(value.split('.'));
				if (formInfo) {
					currentFormName = value;
					currentFileName = fileName;
					RunFormEditor(formInfo);
				}
			})
		}
		else
			vscode.window.showErrorMessage('There is no any form');
		if (lastSessionLogging) {
			try {
				fs.writeFileSync(logDir + 'forms.out', JSON.stringify(forms));
				fs.writeFileSync(logDir + 'result.out', StringifyCircular(result.Copy()));
				fs.writeFileSync(logDir + 'src.out', StringifyCircular(src.statements));
			}
			catch (e) {/*ignore any error*/ }
		}

	}
	catch (e) {
		vscode.window.showErrorMessage(e.message);
		fs.writeFileSync('d:\\tmp\\error.out', e.stack);
	}
}

const initialConfigurations = [
	{
		type: 'bazis',
		request: 'launch',
		name: localize('bazis.launch.config.name', "Запустить"),
		sourceMaps: true,
		program: '${file}'
	}
];

export function activate(context: vscode.ExtensionContext) {
	vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument);
	vscode.commands.registerCommand('bazis-debug.addDeclarationFiles', () => {
		addDeclarationFiles();
	});

	//read settings
	let bazConfig = vscode.workspace.getConfiguration('bazis-debug');
	lastSessionLogging = bazConfig.get('lastSessionLogging', false);

	formEditorPath = bazConfig.get('formEditorPath', '');
	if (!formEditorPath) {
		let regKey = new Registry({
			hive: Registry.HKCU,
			key: '\\Software\\BazisSoft\\' + bazConfig.get('bazisVersion')
		})
		regKey.values((err, items) => {
			if (!err) {
				let exePath: string | undefined;
				for (var i = 0; i < items.length; i++) {
					if (items[i].name === 'Path') {
						exePath = items[i].value;
						break;
					}
				}
				if (exePath) {
					formEditorPath = path.dirname(exePath) + '\\' + FormEditorFileName;
					if (!fs.existsSync(formEditorPath))
						formEditorPath = '';
				}
			}
		});
	}

	vscode.commands.registerCommand('bazis-debug.openFormEditor', openFormEditor);

	context.subscriptions.push(vscode.commands.registerCommand('bazis-debug.provideInitialConfigurations', () => {
		const packageJsonPath = join(vscode.workspace.rootPath, 'package.json');
		let program = vscode.workspace.textDocuments.some(document => document.languageId === 'typescript') ? 'app.ts' : undefined;

		try {
			const jsonContent = fs.readFileSync(packageJsonPath, 'utf8');
			const jsonObject = JSON.parse(jsonContent);
			if (jsonObject.main) {
				program = jsonObject.main;
			} else if (jsonObject.scripts && typeof jsonObject.scripts.start === 'string') {
				program = (<string>jsonObject.scripts.start).split(' ').pop();
			}

		} catch (error) {
			// silently ignore
		}

		if (program) {
			program = isAbsolute(program) ? program : join('${workspaceRoot}', program);
			initialConfigurations.forEach(config => {
				if (!config['program']) {
					config['program'] = program || 'app.ts';
				}
			});
		}
		if (vscode.workspace.textDocuments.some(document => document.languageId === 'typescript' || document.languageId === 'coffeescript')) {
			initialConfigurations.forEach(config => {
				config['sourceMaps'] = true;
			});
		}
		// Massage the configuration string, add an aditional tab and comment out processId.
		// Add an aditional empty line between attributes which the user should not edit.
		const configurationsMassaged = JSON.stringify(initialConfigurations, null, '\t').replace(',\n\t\t"processId', '\n\t\t//"processId')
			.split('\n').map(line => '\t' + line).join('\n').trim();

		addDeclarationFiles();

		return [
			'{',
			'\t// Use IntelliSense to learn about possible Node.js debug attributes.',
			'\t// Hover to view descriptions of existing attributes.',
			'\t// For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387',
			'\t"version": "0.2.0",',
			'\t"configurations": ' + configurationsMassaged,
			'}'
		].join('\n');
	}));
}

export function deactivate() {
}
