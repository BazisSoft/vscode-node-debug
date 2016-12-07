/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { spawn, exec } from 'child_process';
import { basename, join, isAbsolute } from 'path';
import * as nls from 'vscode-nls';
import * as fs from 'fs';

const localize = nls.config(process.env.VSCODE_NLS_CONFIG)();

interface ProcessItem extends vscode.QuickPickItem {
	pid: string;	// payload for the QuickPick UI
}

function listProcesses() : Promise<ProcessItem[]> {

	return new Promise((resolve, reject) => {

		const NODE = new RegExp('^(?:node|iojs|gulp)$', 'i');

		if (process.platform === 'win32') {

			const CMD_PID = new RegExp('^(.+) ([0-9]+)$');
			const EXECUTABLE_ARGS = new RegExp('^(?:"([^"]+)"|([^ ]+))(?: (.+))?$');

			let stdout = '';
			let stderr = '';

			const cmd = spawn('cmd');

			cmd.stdout.on('data', data => {
				stdout += data.toString();
			});
			cmd.stderr.on('data', data => {
				stderr += data.toString();
			});

			cmd.on('exit', () => {

				if (stderr.length > 0) {
					reject(stderr);
				} else {
					const items : ProcessItem[]= [];

					const lines = stdout.split('\r\n');
					for (const line of lines) {
						const matches = CMD_PID.exec(line.trim());
						if (matches && matches.length === 3) {

							let cmd = matches[1].trim();
							const pid = matches[2];

							// remove leading device specifier
							if (cmd.indexOf('\\??\\') === 0) {
								cmd = cmd.replace('\\??\\', '');
							}

							let executable_path: string | undefined;
							let args : string;
							const matches2 = EXECUTABLE_ARGS.exec(cmd);
							if (matches2 && matches2.length >= 2) {
								if (matches2.length >= 3) {
									executable_path = matches2[1] || matches2[2];
								} else {
									executable_path = matches2[1];
								}
								if (matches2.length === 4) {
									args = matches2[3];
								}
							}

							if (executable_path) {

								const executable_name = basename(executable_path);
								if (!NODE.test(executable_name)) {
									continue;
								}

								items.push({
									label: executable_name,
									description: pid,
									detail: cmd,
									pid: pid
								});
							}
						}
					};

					resolve(items);
				}
			});

			cmd.stdin.write('wmic process get ProcessId,CommandLine \n');
			cmd.stdin.end();

		} else {	// OS X & Linux

			const PID_CMD = new RegExp('^\\s*([0-9]+)\\s+(.+)$');
			const MAC_APPS = new RegExp('^.*/(.*).(?:app|bundle)/Contents/.*$');

			exec('ps -ax -o pid=,command=', { maxBuffer: 1000*1024 }, (err, stdout, stderr) => {

				if (err || stderr) {
					reject(err || stderr.toString());
				} else {
					const items : ProcessItem[]= [];

					const lines = stdout.toString().split('\n');
					for (const line of lines) {

						const matches = PID_CMD.exec(line);
						if (matches && matches.length === 3) {

							const pid = matches[1];
							const cmd = matches[2];
							const parts = cmd.split(' '); // this will break paths with spaces
							const executable_path = parts[0];
							const executable_name = basename(executable_path);

							if (!NODE.test(executable_name)) {
								continue;
							}

							let application = cmd;
							// try to show the correct name for OS X applications and bundles
							const matches2 = MAC_APPS.exec(cmd);
							if (matches2 && matches2.length === 2) {
								application = matches2[1];
							} else {
								application = executable_name;
							}

							items.unshift({		// build up list reverted
								label: application,
								description: pid,
								detail: cmd,
								pid: pid
							});
						}
					}

					resolve(items);
				}
			});
		}
	});
}

const initialConfigurations = [
	{
		type: 'bazis',
		reques: 'launch',
		name: localize('bazis.launch.config.name', "Launch Program"),
		sourceMaps: true,
		program: '${file}'
	}
];

export function activate(context: vscode.ExtensionContext) {

	let pickNodeProcess = vscode.commands.registerCommand('extension.pickNodeProcess', () => {

		return listProcesses().then(items => {

			let options : vscode.QuickPickOptions = {
				placeHolder: localize('pickNodeProcess', "Pick the node.js or gulp process to attach to"),
				matchOnDescription: true,
				matchOnDetail: true
			};

			return vscode.window.showQuickPick(items, options).then(item => {
				return item ? item.pid : null;
			});
		});

	});
	context.subscriptions.push(pickNodeProcess);

	context.subscriptions.push(vscode.commands.registerCommand('extension.node-debug.provideInitialConfigurations', () => {
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
				if (config['program']) {
					config['program'] = program;
				}
			});
		}
		if (vscode.workspace.textDocuments.some(document => document.languageId === 'typescript' || document.languageId === 'coffeescript')) {
			initialConfigurations.forEach(config => {
				config['outFiles'] = [];
				config['sourceMaps'] = true;
			});
		}
		// Massage the configuration string, add an aditional tab and comment out processId.
		// Add an aditional empty line between attributes which the user should not edit.
		const configurationsMassaged = JSON.stringify(initialConfigurations, null, '\t').replace(',\n\t\t"processId', '\n\t\t//"processId')
			.split('\n').map(line => '\t' + line).join('\n').trim();

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
