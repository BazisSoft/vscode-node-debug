import * as ts from 'typescript';
import { bzConsts } from './formConstants';

export namespace bazCode {

	let missedNodes: string[] = [];
	let warnings: string[] = [];

	function AddMissedNode(msg: string) {
		missedNodes.push(msg);
	}

	function AddWarn(msg: string) {
		warnings.push(msg);
	}

	export enum InfoState {
		None = 0,
		NeedProp = 1,
		NeedInitialization = 2,
		ParseInitialization = 3
	}

	export enum InfoKind {
		SourceInfo = 0,
		BaseInfo = 1,
		ValueInfo = 2,
		ObjectInfo = 3,
		FunctionInfo = 4,
		ReferenceInfo = 5
	}

	class ParseError extends Error {

	}

	export class InfoRange {
		constructor(pos?: number, end?: number) {
			this.pos = pos || 0;
			this.end = end || 0;
		}
		pos: number;
		end: number
		Copy(): InfoRange {
			let result = new InfoRange(this.pos, this.end);
			return result
		}
		IsEmpty(): boolean {
			return this.pos === 0 && this.end === 0;
		}
		Equals(range: InfoRange): boolean {
			return range.pos === this.pos && range.end === this.end;
		}
	}

	export class BaseInfo {
		constructor(name: string, src: SourceInfo) {
			this.name = name;
			this.source = src;
		}
		private _prevStates: Array<InfoState> = [];
		PushState(st: InfoState) {
			this._prevStates.push(this.state);
			this.state = st;
		}
		PopState() {
			this.state = this._prevStates.pop() || InfoState.None;
		}
		name: string;
		kind: InfoKind = InfoKind.BaseInfo;
		range: InfoRange;
		state: InfoState = InfoState.None;
		source: SourceInfo;
		/**
		 * add item to this info
		 * @param item An object/var/function, will be added to info
		 */
		AddNewItem(item: BaseInfo) {
			throw new ParseError('can\'t add item to BaseInfo')
		}
		CopyParamsTo(newInfo: BaseInfo, circular: boolean) {
			newInfo.range = this.range ? this.range.Copy() : new InfoRange();
		}
		Copy(src: SourceInfo): BaseInfo {
			let result = new BaseInfo(this.name, src);
			this.CopyParamsTo(result, false);
			return result;
		}
	}

	class ObjectArrayInfo extends BaseInfo {
		AddNewItem(item: BaseInfo) {
			if (item instanceof ObjectInfo)
				this.array.push(item);
			else
				throw new ParseError('can\'t add BaseInfo to ObjectArray')
		}
		ClearCircular() {
			this.source = <any>undefined;
			for (let i = 0; i < this.array.length; i++) {
				if (this.array[i] instanceof ObjectInfo) {
					this.array[i] = <any>this.array[i].GetFullName().join('.');
				}
			}
		}
		array: Array<ObjectInfo> = [];
	}

	export class ObjectInfo extends BaseInfo {
		constructor(name: string, src: SourceInfo, range?: InfoRange, init?: boolean) {
			super(name, src);
			if (range)
				this.range = range;
			this.initialized = init || false;
			this.kind = InfoKind.ObjectInfo;
		}
		private _value?: string;
		/**
		 * value of this variable (only for primitive variables)
		 */
		set value(val: string) {
			this._value = val;
			this.kind = InfoKind.ValueInfo;
			this.initialized = true;
		}
		get value(): string {
			return this._value || '';
		}

		private _ref?: ObjectInfo;
		/**
		 * base value, which is in this var
		 * e.g: let a = b.c.
		 * If 'this' contains ObjectInfo of 'a' then refersTo will contain ObjectInfo of 'c' var
		 */
		get refersTo() {
			return <ObjectInfo>this._ref;
		};
		set refersTo(ref: ObjectInfo) {
			this._ref = ref;
			this.kind = InfoKind.ReferenceInfo;
			this.initialized = true;
		}
		owner?: ObjectInfo;
		/**
		 * reference to function, which creates this object
		 */
		initializer?: ObjectInfo;
		initialized: boolean = false;
		/**range of full expression, which initializes this object */
		initRange: InfoRange;
		valueRange?: InfoRange;


		/**
		 * returns full name of object like 'OwnerName.Name'
		 */
		GetFullName(removeRef?: boolean): string[] {
			if (removeRef && this._ref) {
				return this._ref.GetFullName();
			}
			else {
				let result: string[] = [];
				if (this.owner) {
					if (this.owner instanceof BaseInfo)
						result = this.owner.GetFullName();
					else //result should be string
						result = (<any>this.owner).split('.');
				}
				result.push(this.name);
				return result;
			}
		}

		CopyParamsTo(newInfo: ObjectInfo) {
			newInfo.initRange = this.initRange ? this.initRange.Copy() : new InfoRange();
			if (this.value) {
				newInfo.value = this.value;
				//we are sure if value exists then its range exists too
				newInfo.valueRange = (<InfoRange>this.valueRange).Copy();
			}
			if (this.owner) {
				newInfo.owner = newInfo.source.FindVariable(this.owner.GetFullName(), false);
			}
			if (this.refersTo) {
				newInfo.refersTo = newInfo.source.FindVariable(this.refersTo.GetFullName(), false);
			}
			if (this.initializer) {
				if (this.initializer.kind === InfoKind.FunctionInfo) {
					newInfo.initializer = this.initializer.Copy(newInfo.source);
				}
				else
					newInfo.initializer = newInfo.source.FindVariable(this.initializer.GetFullName(), false);
			}
		}
		Copy(source: SourceInfo): ObjectInfo {
			let result = new ObjectInfo(this.name, source);
			this.CopyParamsTo(result);
			return result;
		}

		AddNewItem(item: BaseInfo) {
			if (!(item instanceof ObjectInfo))
				throw new ParseError('item is not a variable');
			if (this.state === InfoState.NeedInitialization) {
				if (item.kind === InfoKind.ValueInfo) {
					this.value = item.value;
					this.valueRange = item.valueRange;
				}
				else
					this.initializer = item;
				this.initialized = true;
			}
			else {
				(<ObjectInfo>item).owner = this;
				switch (this.state) {
					case InfoState.ParseInitialization: {
						item.initRange = this.initRange;
						break;
					}
				}
				this.source.AddNewItem(item);
			}
		}
		RelatedTo(objectFullName: string[]): boolean {
			let fullname = this.GetFullName(true);
			let result = bzConsts.IsOwner(fullname, objectFullName) ||
				bzConsts.NamesEqual(fullname, objectFullName);
			if (!result){
				let initOwner = this.initializer? this.initializer.owner: undefined;
				if (initOwner){
					fullname = initOwner.GetFullName(true);
					result = bzConsts.IsOwner(fullname, objectFullName) ||
						bzConsts.NamesEqual(fullname, objectFullName);
				}
			}
			return result;
		}
	}

	export class FunctionInfo extends ObjectInfo {
		args: Array<ObjectInfo> = [];
		public Copy(src: SourceInfo): FunctionInfo {
			let result = new FunctionInfo(this.name, src);
			for (let i = 0; i < this.args.length; i++) {
				result.args.push(this.args[i].Copy(src));
			}
			if (this.owner) {
				result.owner = src.FindVariable(this.owner.GetFullName(), false);
			}
			return result;
		}
		kind: InfoKind = InfoKind.FunctionInfo;
	}

	export class SourceInfo extends BaseInfo {
		constructor(fileName: string, range: InfoRange) {
			super(fileName, <any>undefined);
			this.source = this;
			this.range = range;
			this.variables = [];
			this.kind = InfoKind.SourceInfo;
		}
		private AddVar(variable: ObjectInfo) {
			this.variables.push(variable);
		}

		public AddNewItem(item: BaseInfo) {
			if (!(item instanceof ObjectInfo))
				throw new ParseError('new item is not ObjectInfo');
			else {
				this.AddVar(item);
			}
		}
		/**
		 * find variable by FULL name
		 * @param fullName splitted full object name like ['OwnerName', 'Name']
		 */
		public FindVariable(fullName: string[], createIfNotFound: boolean): ObjectInfo {
			for (let i = 0; i < this.variables.length; i++) {
				let variable = this.variables[i];
				if (bzConsts.NamesEqual(variable.GetFullName(), fullName)) {
					return variable;
				}
			}
			let result: ObjectInfo | undefined;
			//if no one variable found
			if (createIfNotFound) {
				let newObj = new ObjectInfo(fullName[fullName.length - 1], this.source, this.range.Copy());
				if (fullName.length > 1) {
					let owner = this.FindVariable(fullName.slice(0, fullName.length - 1), createIfNotFound);
					newObj.range = owner.range.Copy();
					newObj.initRange = owner.initRange.Copy();
					newObj.owner = owner;
				}
				this.variables.push(newObj);
				result = newObj;
			}
			if (!result)
				throw new ParseError(`can't find variable ${fullName.join('.')} in SourceInfo.FindVariable`);
			return result;
		}

		public VariableExists(fullname: string[]): boolean {
			try {
				this.FindVariable(fullname, false);
				return true;
			} catch (e) {
				return false;
			}
		}

		/**
		 * it will return function (even if it wasn't created)
		 * @param fullName splitted full name of function
		 */
		public FindFunction(fullName: string[]): FunctionInfo {

			for (let i = 0; i < this.variables.length; i++) {
				let variable = this.variables[i];
				if (bzConsts.NamesEqual(variable.GetFullName(), fullName) && variable instanceof FunctionInfo) {
					return variable;
				}
			}
			let result: FunctionInfo | undefined;
			//if no one variable found
			let newFunc = new FunctionInfo(fullName[fullName.length - 1], this.source, this.range.Copy());
			if (fullName.length > 1) {
				let owner = this.FindVariable(fullName.slice(0, fullName.length - 1), true);
				newFunc.range = owner.range.Copy();
				newFunc.owner = owner;
			}
			result = newFunc;
			if (!result)
				throw new ParseError(`can't create function ${fullName.join('.')} in SourceInfo.FindFunction`);
			return result;

		}
		Copy(): SourceInfo {
			let result = new SourceInfo(this.name, this.range.Copy());
			result.source = result;
			for (let i = 0; i < this.variables.length; i++) {
				result.variables.push(this.variables[i].Copy(result));
			}
			return result;
		}
		ClearEmpty() {
			let vars = this.variables;
			for (let i = vars.length - 1; i >= 0; i--) {
				let elem = vars[i];
				if (!elem.range || elem.range.Equals(this.range))
					vars.splice(i, 1);
			}
		}
		variables: Array<ObjectInfo>;
		version: number;

		fileName: string;
	}

	//Additional functions

	function getFullNameOfObjectInfo(expr: ts.Expression, result?: string[]): string[] {
		if (!result)
			result = [];
		if (expr) {
			switch (expr.kind) {
				case (ts.SyntaxKind.PropertyAccessExpression): {
					let prop = <ts.PropertyAccessExpression>expr;
					let newExpr = prop.expression;
					if (newExpr) {
						result = getFullNameOfObjectInfo(newExpr, result);
					}
					let name = prop.name;
					if (name.text) {
						result.push(name.text);
					}
					break;
				}
				case (ts.SyntaxKind.Identifier): {
					result.push((<ts.Identifier>expr).text);
					break;
				}
				default: {
					AddMissedNode(`GetFullNameOfObjectInfo: syntax kind ${expr.kind} is missed`);
				}
			}
		}
		return result;
	}

	function MakeObject(name: string, source: SourceInfo, range?: InfoRange): ObjectInfo {
		let result = new ObjectInfo(name, source, range);
		return result;
	}

	function GetFullInitRange(node: ts.Node): InfoRange {
		let result = new InfoRange(node.pos, node.end);
		let rootNode = node;
		let parent = rootNode.parent;
		while (parent && (parent.kind !== ts.SyntaxKind.SourceFile)) {
			rootNode = parent;
			parent = rootNode.parent;
		}
		if (rootNode !== node) {
			if (Math.abs(rootNode.end - node.end) < 2)
				result.end = rootNode.end;
		}
		return result;
	}

	/**
	 * Make initialization info for obj from init
	 * @param init Initializer expression
	 * @param obj Object, which initializer we need to parse
	 */
	function parseInitializer(init: ts.Expression | undefined, obj: ObjectInfo) {
		if (init) {
			switch (init.kind) {
				case (ts.SyntaxKind.ObjectLiteralExpression): {
					let expr = <ts.ObjectLiteralExpression>init;
					obj.PushState(InfoState.ParseInitialization);
					for (let i = 0; i < expr.properties.length; i++) {
						parseNode(expr.properties[i], obj);
					}
					obj.PopState();
					break;
				}
				case (ts.SyntaxKind.CallExpression): {
					let expr = <ts.CallExpression>init;
					let func = new FunctionInfo('', obj.source);
					let parsedFunc = parseNode(expr, func);
					if (parsedFunc instanceof FunctionInfo)
						obj.initializer = parsedFunc;
					else
						throw new ParseError(`initializer call isn't function`);
					break;
				}
				case ts.SyntaxKind.PropertyAccessExpression: {
					parseNode(init, obj);
					break;
				}
				case ts.SyntaxKind.FalseKeyword: {
					obj.value = false.toString();
					obj.valueRange = new InfoRange(init.pos, init.end);
					break;
				}
				case ts.SyntaxKind.TrueKeyword: {
					obj.value = true.toString();
					obj.valueRange = new InfoRange(init.pos, init.end);
					break;
				}
				case ts.SyntaxKind.NumericLiteral:
				case ts.SyntaxKind.StringLiteral: {
					let value = (<ts.StringLiteral>init).text;
					obj.value = value;
					obj.valueRange = new InfoRange(init.pos, init.end);
					break
				}
				default: {
					throw new ParseError(`ParseInitializer: syntax kind ${init.kind} missed`);
				}
			}
		}
	}

	/**
	 * parse variable declaration and add new variable to info
	 * @param decl Variable declaration
	 * @param info Object\Source - owner of new variable
	 */
	function parseVariableDeclaration(decl: ts.VariableDeclaration, info: BaseInfo) {
		let declName = decl.name;
		let objName = '';
		switch (declName.kind) {
			case (ts.SyntaxKind.Identifier): {
				let id = (<ts.Identifier>declName);
				objName = id.text;
				break;
			}
			default: {
				throw new ParseError(`VariableDeclaration: Syntax kind ${declName.kind} missed`);
			}
		}
		if (!info.source)
			throw new ParseError(`info '${info.name}' doesn't have a source`);
		let newObj = MakeObject(objName, info.source, new InfoRange(decl.pos, decl.end))
		if (decl.parent && decl.parent.kind === ts.SyntaxKind.VariableDeclarationList &&
			(<ts.VariableDeclarationList>decl.parent).declarations.length === 1) {
			newObj.initRange = GetFullInitRange(decl.parent);
		}
		else
			newObj.initRange = GetFullInitRange(decl);
		parseInitializer(decl.initializer, newObj);
		newObj.initialized = true;
		info.AddNewItem(newObj);
	}

	function parseCallExpression(expr: ts.CallExpression, info: BaseInfo): FunctionInfo | undefined {
		let fullCallName = getFullNameOfObjectInfo(expr.expression);
		let newFunc = info.source.FindFunction(fullCallName);
		newFunc.range = new InfoRange(expr.pos, expr.end);
		newFunc.initRange = GetFullInitRange(expr);
		let funcArgs = new ObjectArrayInfo('', info.source);
		let exprArgs = expr.arguments;
		if (exprArgs) {
			for (let i = 0; i < exprArgs.length; i++)
				parseNode(exprArgs[i], funcArgs);
		}
		newFunc.args = newFunc.args.concat(funcArgs.array);
		if (info instanceof FunctionInfo && info.name === '') {
			return newFunc;
		}
		else {
			info.AddNewItem(newFunc);
			return undefined;
		}
	}
	function parsePropertyAssignment(node: ts.PropertyAssignment, info: BaseInfo) {

		let propName = '';
		switch (node.name.kind) {
			case ts.SyntaxKind.Identifier: {
				propName = (<ts.Identifier>node.name).text;
				break;
			}
			default: {
				break;
			}
		}
		if (propName) {
			let newProp = new ObjectInfo(propName, info.source, new InfoRange(node.pos, node.end));
			newProp.initRange = GetFullInitRange(node);
			parseInitializer(node.initializer, newProp);
			newProp.initialized = true;
			info.AddNewItem(newProp);
		}
	}

	function MakeValue(value: string | boolean, range: InfoRange, src: SourceInfo): ObjectInfo {
		let result = new ObjectInfo('', src, range);
		result.value = <string>value;
		result.valueRange = range;
		return result
	}

	function parseBinaryExpression(expr: ts.BinaryExpression, info: BaseInfo) {
		let left = expr.left;
		let right = expr.right;
		let token = expr.operatorToken;
		let fullPropName = getFullNameOfObjectInfo(left);
		let prop = info.source.FindVariable(fullPropName, true);
		prop.range = new InfoRange(expr.pos, expr.end);
		switch (token.kind) {
			case ts.SyntaxKind.FirstAssignment: {
				prop.initRange = GetFullInitRange(expr);
				prop.PushState(InfoState.NeedInitialization);
				parseNode(right, prop);
				prop.PopState();
				break;
			}
			default: {
				AddMissedNode(`ParseBinaryExpression: token with kind ${token.kind} is missed`);
				break;
			}
		}
	}

	function parsePropertyAccessExpression(expr: ts.PropertyAccessExpression, info: BaseInfo) {
		if (info instanceof ObjectInfo) {
			let propName = getFullNameOfObjectInfo(expr);
			let constValue = bzConsts.GetConstantValue(propName);
			if (constValue !== undefined) {
				//toString called here because zero value will be transfomed into empty string
				info.value = constValue.toString();
				info.valueRange = new InfoRange(expr.pos, expr.end);
			}
			else {
				info.refersTo = info.source.FindVariable(propName, true);
			}
		}
		else {
			AddWarn(`parsePropertyAccessExpression: info isn't Object info in '${expr.getFullText()}'`);
		}
	}

	function parseNode(node: ts.Node, info: BaseInfo): BaseInfo {
		let needParseChilds = false;
		switch (node.kind) {
			case ts.SyntaxKind.FalseKeyword: {
				let newVal = MakeValue(false, new InfoRange(node.pos, node.end), info.source);
				info.AddNewItem(newVal);
				break;
			}
			case ts.SyntaxKind.TrueKeyword: {
				let newVal = MakeValue(true, new InfoRange(node.pos, node.end), info.source);
				info.AddNewItem(newVal);
				break;
			}
			case ts.SyntaxKind.StringLiteral:
			case ts.SyntaxKind.NumericLiteral: {
				let value = (<ts.NumericLiteral>node).text;
				let newVal = MakeValue(value, new InfoRange(node.pos, node.end), info.source);
				info.AddNewItem(newVal);
				break;
			}
			case ts.SyntaxKind.Identifier: {
				let name = (<ts.Identifier>node).text;
				let identifierObject = info.source.FindVariable([name], true);
				let copy = new ObjectInfo('', info.source, new InfoRange(node.pos, node.end));
				copy.refersTo = identifierObject;
				copy.initRange = GetFullInitRange(node);
				info.AddNewItem(copy);
				break;
			}
			case ts.SyntaxKind.ExpressionStatement: {
				let expr = (<ts.ExpressionStatement>node).expression;
				if (expr)
					parseNode(expr, info);
				break;
			}
			case ts.SyntaxKind.VariableDeclaration: {
				parseVariableDeclaration(<ts.VariableDeclaration>node, info);
				break;
			}
			case ts.SyntaxKind.BinaryExpression: {
				parseBinaryExpression(<ts.BinaryExpression>node, info);
				break;
			}
			case ts.SyntaxKind.PropertyAssignment: {
				parsePropertyAssignment(<ts.PropertyAssignment>node, info);
				break;
			}
			case ts.SyntaxKind.PropertyAccessExpression: {
				parsePropertyAccessExpression(<ts.PropertyAccessExpression>node, info);
				break;
			}
			case ts.SyntaxKind.CallExpression: {
				let call = parseCallExpression(<ts.CallExpression>node, info);
				if (call) {
					info = call;
				}
				break;
			}
			case ts.SyntaxKind.ShorthandPropertyAssignment: {
				let varName = (<ts.ShorthandPropertyAssignment>node).name.text;
				let newVar = new ObjectInfo(varName, info.source, new InfoRange(node.pos, node.end));
				info.AddNewItem(newVar);
				break;
			}
			case ts.SyntaxKind.ObjectLiteralExpression: {
				let stateSetted = false;
				if (info.state === InfoState.NeedInitialization) {
					info.PushState(InfoState.None);
					stateSetted = true;
				}
				let expr = <ts.ObjectLiteralExpression>node;
				info.PushState(InfoState.ParseInitialization)
				for (let i = 0; i < expr.properties.length; i++) {
					parseNode(expr.properties[i], info);
				}
				info.PopState();
				if (stateSetted)
					info.PopState();
				if (info instanceof ObjectInfo) {
					info.initialized = true;
				}
				break;
			}
			//not parsed now, but for future
			case ts.SyntaxKind.FunctionExpression:
			case ts.SyntaxKind.IfStatement: {
				break;
			}

			//don't parse them, but parse their childs
			case ts.SyntaxKind.VariableStatement:
			case ts.SyntaxKind.VariableDeclarationList:
			case ts.SyntaxKind.Block:
			case ts.SyntaxKind.SourceFile: {
				needParseChilds = true;
				break;
			}

			//we don't parse this
			case ts.SyntaxKind.EndOfFileToken: {
				break;
			}
			default: {
				// needParseChilds = true;
				AddMissedNode(`ParseNode: missed kind: ${node.kind} at pos ${node.pos}`);
				break;
			}
		}
		if (needParseChilds)
			ts.forEachChild(node, (child) => {
				parseNode(child, info);
			})
		return info;
	}


	export function parseSource(src: ts.SourceFile, errorlogger: (error: string) => void): SourceInfo {
		let result = new SourceInfo('', new InfoRange(src.pos, src.end));
		result.fileName = src.fileName;
		missedNodes = [];
		try {
			result = <SourceInfo>parseNode(src, result);
		}
		catch (e) {
			if (errorlogger)
				errorlogger(e.stack);
		}
		if (missedNodes.length > 0)
			errorlogger(`SourceFile: ${src.fileName}:\n\t${missedNodes.join('\n\t')} \n============================================\n`);
		if (warnings.length > 0)
			errorlogger(`SourceFile: ${src.fileName}: Warnings:\n\t${warnings.join('\n\t')} \n============================================\n`);
		result.ClearEmpty();
		return result;
	}



	//parsers for in messages

	export class TextChange {
		constructor() {
			this.pos = 0,
				this.end = 0,
				this.newText = '';
		}
		pos: number;
		end: number;
		newText: string;
	}

	interface NewComponentMessage {
		name: string;
		type: string;
		layout: bzConsts.Layout;
		args: string[] | undefined;
		owner: string;
	}

	export function MakeNewComponent(msg: any, parsedSource: SourceInfo): TextChange {
		let result = new TextChange();
		let newComponentInfo = <NewComponentMessage>msg;
		let componentOwner = newComponentInfo.owner.split('.');
		let owner = parsedSource.FindVariable(componentOwner, true);
		let start = owner.initRange.end;
		result.pos = result.end = start;
		let name = newComponentInfo.name;
		let i = 1;
		while (parsedSource.VariableExists([name + i])) {
			i++;
		}
		name = name + i;
		let type = newComponentInfo.type;
		/** layout */
		let lo = newComponentInfo.layout;
		let args = newComponentInfo.args || [];
		let newText = '';
		if (bzConsts.IsComponentConstructor(type)) {
			newText = `\nlet ${name} = ${owner.GetFullName().join('.')}.${type}(${args.join(', ')});` +
				`\n${name}.${bzConsts.LayoutFuncName}(${lo.left}, ${lo.top}, ${lo.width}, ${lo.height});`
		}
		result.newText = newText;
		return result;
	}

	function GetLayoutIndex(layoutName: string): number {
		switch (layoutName) {
			case 'Left': return 0;
			case 'Top': return 1;
			case 'Width': return 2;
			case 'Height': return 3;
			default: return -1;
		}
	}

	interface PropertyChangeMessage {
		component: string;
		property: string;
		value: string;
	}
	export function ChangeProperty(msg: any, parsedSource: SourceInfo): TextChange {
		let result = new TextChange();
		let changeInfo = <PropertyChangeMessage>msg;
		let fullCompName = changeInfo.component;
		let propName = changeInfo.property;
		let newValue = changeInfo.value;
		let comp = parsedSource.FindVariable(fullCompName.split('.'), false);
		/**index of layout's property */
		let lIndex = -1;
		if (comp.initializer && bzConsts.IsComponentConstructor(comp.initializer.name))
			lIndex = GetLayoutIndex(propName);
		if (lIndex === -1) {
			try{
				let prop = comp.source.FindVariable(fullCompName.split('.').concat([propName]), false);
				let resultExists = false;
				if (!(prop instanceof FunctionInfo)) {
					if (prop.valueRange) {
						result.pos = prop.valueRange.pos;
						result.end = prop.valueRange.end;
						result.newText = ' ' + newValue;
						resultExists = true;
					}
				}
				if (!resultExists) {
					if (prop.initRange) {
						result.pos = prop.initRange.pos;
						result.end = prop.initRange.end;
					}
					else if (prop.range) {
						result.pos = prop.range.pos;
						result.end = prop.range.end;
					}
					else {
						result.pos = result.end = comp.initRange.end;
					}
					if (prop instanceof FunctionInfo) {
						result.newText = `\n${fullCompName}.${propName}(${newValue});`
					}
					else {
						result.newText = `\n${fullCompName}.${propName} = ${newValue};`
					}
				}
			}
			catch(e){
				result.pos = result.end = comp.initRange.end;
				result.newText = `\n${fullCompName}.${propName} = ${newValue};`
			}
		}
		else {
			let layout = comp.source.FindFunction(fullCompName.split('.').concat([bzConsts.LayoutFuncName]));
			if (layout && !layout.range.IsEmpty()) {
				let argRange = layout.args[lIndex].range;
				result.pos = argRange.pos;
				result.end = argRange.end;
				result.newText = newValue;
			}
			else {
				result.pos = result.end = comp.initRange.end;
				result.newText = `\n${fullCompName}.${propName} = ${newValue};`;
			}
		}
		return result;
	}


	interface DeleteCompMessage {
		fullname: string;
	}

	export function DeleteComponent(msg: any, parsedSource: SourceInfo): Array<TextChange> {
		let result = new Array<TextChange>();
		let compname = (<DeleteCompMessage>msg).fullname;
		let names = [compname.split('.')];
		let compRanges = new Array<InfoRange>();
		parsedSource.variables.forEach(value => {
			for (let i = 0; i < names.length; i++) {
				if (value.RelatedTo(names[i])) {
					compRanges.push(value.initRange);
					if (value.kind === InfoKind.ObjectInfo){
						names.push(value.GetFullName(true));
					}
					break;
				}
			}
		})
		compRanges.forEach(range => {
			let change = new TextChange();
			change.pos = range.pos;
			change.end = range.end;
			change.newText = '';
			result.push(change);
		})
		return result;
	}


}