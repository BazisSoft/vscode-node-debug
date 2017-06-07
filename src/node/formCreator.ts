import { bazCode } from './CodeParser';
import { bzConsts } from './formConstants';

let InfoKind = bazCode.InfoKind;

export namespace bazForms {
	enum ParsedKind {
		Unknown = 0,
		Value = 1,
		Function = 2,
		Object = 3,
		FormComponent = 4,
		Form = 5,
		Reference = 6,
		ValueArray = 7
	}

	enum ChangeState {
		None = 0,
		Deleted = 1,
		Modified = 2,
		Created = 3
	}

	class ParsedBase {
		constructor(name: string | undefined, kind?: ParsedKind, state?: ChangeState) {
			if (name) {
				this.name = name
			}
			this.kind = kind || ParsedKind.Unknown;
			this.state = state || ChangeState.None;
		}
		kind: ParsedKind;
		state: ChangeState;
		name?: string;
		/** variable's owner name (e.g. ['Window'] for 'Window.Button1');*/
		owner?: string[];
		PushChange(change: ParsedBase) {
			throw new Error(`PushChange: Can't push change ${change.name} in ${typeof this}`);
		}
		/**set state to modified if it wasn't */
		Modify() {
			if (!this.Modified())
				this.state = ChangeState.Modified;
		}
		/** returns true if object was modified, created or deleted */
		Modified(): boolean {
			return this.state !== ChangeState.None;
		}
		GetFullName(): string[] {
			let ownername = this.owner || [];
			return ownername.concat([this.name || '']);
		}
	}

	class ParsedFunction extends ParsedBase {
		constructor(name: string | undefined, state?: ChangeState) {
			super(name, ParsedKind.Function, state);
		}
		args: Array<ParsedBase> = [];
		PushArg(arg: ParsedBase) {
			this.args.push(arg);
		}
		PushChange(change: ParsedBase) {
			if (change.Modified())
				this.Modify();
			this.args.push(change);
		}
	}

	class ParsedValue extends ParsedBase {
		constructor(name: string | undefined, value?: string, state?: ChangeState) {
			super(name, ParsedKind.Value, state);
			if (value)
				this.value = value;
		}
		value: string;
	}

	class ParsedReference extends ParsedBase {
		constructor(name: string | undefined, state?: ChangeState) {
			super(name, ParsedKind.Reference, state);
		}
		ref?: string[];
	}

	class ParsedObject extends ParsedBase {
		constructor(name: string | undefined, state?: ChangeState) {
			super(name, ParsedKind.Object, state);
		}
		/**set state to modified if it wasn't */
		Modify() {
			if (!this.Modified())
				this.state = ChangeState.Modified;
		}
	}

	export class ParsedComponent extends ParsedObject {
		constructor(name: string | undefined, state?: ChangeState) {
			super(name, state);
			this.kind = ParsedKind.FormComponent;
		}
		/**constructor of object*/
		type: string;
		/**arguments of constructor*/
		args: Array<ParsedValue>;
		/** component owner's name */
		compOwner?: string[];
	}

	export class ParsedForm extends ParsedComponent {
		constructor(name: string | undefined, state?: ChangeState) {
			super(name, state);
			this.kind = ParsedKind.Form;
		}
	}

	export function VariableInForm(variable: ParsedBase, form: FormChange): boolean {
		let fullname: string[] = [];
		switch (variable.kind) {
			case ParsedKind.FormComponent: {
				let comp = <ParsedComponent>variable;
				fullname = comp.compOwner || [];
				break;
			}
			case ParsedKind.Object: {
				fullname = (<ParsedObject>variable).owner || [];
			}
			case ParsedKind.Value: {
				fullname = (<ParsedValue>variable).owner || [];
			}
			case ParsedKind.Function:{
				fullname = (<ParsedFunction>variable).owner || [];
			}
		}
		if (fullname.length === 0)
			return false;
		for (let i = 0; i < form.length; i++) {
			if (bzConsts.NamesEqual(fullname, form[i].GetFullName()))
				return true;
		}
		return false;
	}

	function RemoveNonModified(form: FormChange){
		for (let i = form.length - 1; i > -1; i--){
			if (!form[i].Modified())
				form.splice(i, 1);
		}
	}

	export class FormChange extends Array<ParsedBase>{

	}

	export class Forms extends ParsedBase {
		variables: Array<ParsedBase> = [];
		PushChange(change: ParsedBase) {
			this.variables.push(change);
		}
		FindOwner(fullname: string[]): ParsedBase | undefined {
			let result: ParsedBase | undefined;
			this.variables.forEach(val => {
				if (val.GetFullName() === fullname)
					result = val;
			})
			if (!result && ErrorLog) {
				ErrorLog(`FindOwner: can't find ${fullname.join('.')}`);
			}
			return result;
		};

		GetFormNames(): string[] {
			let result: string[] = [];
			this.variables.forEach(variable => {
				if (variable.kind === ParsedKind.Form)
					result.push(variable.GetFullName().join('.'))
			})
			return result
		}

		GetFormUpdate(formName: string[]): FormChange {
			let result = new FormChange();
			this.variables.forEach(variable => {
				if (bzConsts.NamesEqual(variable.GetFullName(), formName)) {
					result.push(variable);
				}
				else {
					if (VariableInForm(variable, result)) {
						result.push(variable);
					}
				}
			})
			RemoveNonModified(result);
			return result;
		}
	}

	function SpliceVariable(oldVar: bazCode.ObjectInfo, newArr: Array<bazCode.ObjectInfo>): bazCode.BaseInfo | undefined {
		if (oldVar)
			for (let i = 0; i < newArr.length; i++) {
				if (bzConsts.NamesEqual(newArr[i].GetFullName(), oldVar.GetFullName()))
					return newArr.splice(i, 1)[0];
			}
		return undefined;
	}

	function CompareVariableArrays(oldArr: Array<bazCode.ObjectInfo> | undefined, newArr: Array<bazCode.ObjectInfo>, owner: ParsedBase) {
		if (oldArr) {
			oldArr.forEach(item => {
				let newItem = SpliceVariable(item, newArr);
				CompareVariables(item, newItem, owner);
			})
		}
		newArr.forEach(item => {
			CompareVariables(undefined, item, owner);
		})
	}

	function CompareFunctions(oldObj: bazCode.ObjectInfo | undefined, newObj: bazCode.ObjectInfo, owner: ParsedBase): ParsedFunction | undefined {
		if (oldObj && oldObj.kind !== InfoKind.FunctionInfo || newObj.kind !== InfoKind.FunctionInfo)
			return;
		let oldFunc = <bazCode.FunctionInfo>oldObj;
		let newFunc = <bazCode.FunctionInfo>newObj;
		let result = new ParsedFunction(newFunc.name, oldFunc ? ChangeState.None : ChangeState.Created);
		if (newFunc.owner){
			result.owner = newFunc.owner.GetFullName();
		}
		let oldArgs = oldFunc ? oldFunc.args : undefined;
		CompareVariableArrays(oldArgs, newFunc.args, result);
		if (owner)
			owner.PushChange(result);
		else
			return result;
	}

	function CompareForms(oldObj: bazCode.ObjectInfo | undefined, newObj: bazCode.ObjectInfo, owner: ParsedBase): ParsedForm | undefined {
		let result: ParsedForm | undefined;
		let state = oldObj ? ChangeState.None : ChangeState.Created;
		if (newObj) {
			result = new ParsedForm(newObj.name, state);
			let oldInit = oldObj ? oldObj.initializer : undefined;
			let newInit = newObj.initializer;
			if (newInit instanceof bazCode.FunctionInfo) {
				if (!(oldInit instanceof bazCode.FunctionInfo))
					oldInit = undefined;
				//should be always
				result.type = newInit.name;
				let func = CompareFunctions(oldInit, newInit, <any>undefined);
				if (func && func.Modified()) {
					result.args = <any>func.args;
				}
			}
			if (newObj.owner) {
				result.owner = newObj.owner.GetFullName(true);
			}
		}
		else if (oldObj) {
			result = new ParsedForm(oldObj.name, ChangeState.Deleted);
		}

		if (result) {
			currentForms.PushChange(result);
		}
		return result;
	}

	function CompareComponents(oldObj: bazCode.ObjectInfo | undefined, newObj: bazCode.ObjectInfo, owner: ParsedBase) {
		let init = newObj.initializer;
		let state = oldObj ? ChangeState.None : ChangeState.Created;
		if (init) {
			let newComp = new ParsedComponent(newObj.name, state);
			newComp.type = init.name;
			newComp.owner = newObj.owner ? newObj.owner.GetFullName() : undefined;
			if (init.owner) {
				newComp.compOwner = init.owner.GetFullName(true);
			}
			let oldInit: bazCode.ObjectInfo | undefined;
			if (oldObj)
				oldInit = oldObj.initializer;
			let newFunc = CompareFunctions(oldInit, init, <any>undefined);
			if (newFunc && newFunc.Modified()) {
				newComp.args = <any>newFunc.args;
			}
			currentForms.PushChange(newComp);
		}
		else {
			//never
			ErrorLog(`CompareComponents: object ${newObj.GetFullName().join('.')} has no initializer`);
		}
	}

	function CompareObjects(oldObj: bazCode.ObjectInfo | undefined, newObj: bazCode.ObjectInfo, owner: ParsedBase)/*: ParsedBase*/ {

		let oldObjKind = oldObj ? oldObj.kind : newObj.kind;
		let state = oldObj ? ChangeState.None : ChangeState.Created;
		let newParsedObject: ParsedObject | undefined;
		if (oldObjKind === newObj.kind) {
			if (newObj.initializer) {
				let initName = newObj.initializer.GetFullName();
				if (initName.length === 1) {
					if (initName[0] === bzConsts.Constructors.NewForm) {
						CompareForms(oldObj, newObj, owner);
					}
					else {
						newParsedObject = new ParsedObject(newObj.name, state);
						currentForms.PushChange(newParsedObject);
						//TODO: compare objects (for longlong future)
					}
				}
				else {
					//check if last name is comp constructor's name
					if (bzConsts.IsComponentConstructor(initName[initName.length - 1])) {
						CompareComponents(oldObj, newObj, owner);
					}
				}
			}
			else {
				newParsedObject = new ParsedObject(newObj.name, state);
				currentForms.PushChange(newParsedObject);
			}
			if (newParsedObject && newObj.owner) {
				newParsedObject.owner = newObj.owner.GetFullName();
			}
		}
		else {
			//TODO: maybe never
		}
	}

	function CompareVariables(oldVar: bazCode.BaseInfo | undefined, newVar: bazCode.BaseInfo | undefined, owner: ParsedBase): ParsedBase | undefined {
		if (newVar) {
			if (!oldVar || oldVar.kind === newVar.kind) {
				let newChange: ParsedBase | undefined;
				switch (newVar.kind) {
					case InfoKind.ObjectInfo: {
						CompareObjects(<bazCode.ObjectInfo>oldVar, <bazCode.ObjectInfo>newVar, owner);
						break;
					}
					case InfoKind.FunctionInfo: {
						CompareFunctions(<bazCode.FunctionInfo>oldVar, <bazCode.FunctionInfo>newVar, owner);
						break;
					}
					case InfoKind.ValueInfo: {
						let newObj = <bazCode.ObjectInfo>newVar;
						if (!oldVar) {
							newChange = new ParsedValue(newObj.name, newObj.value, ChangeState.Created);
						}
						else {
							let oldObj = <bazCode.ObjectInfo>oldVar;
							if (oldObj.value !== newObj.value) {
								newChange = new ParsedValue(newObj.name, newObj.value, ChangeState.Modified);
							}
						}
						if (newChange && newObj.owner) {
							newChange.owner = newObj.owner.GetFullName();
						}
						break;
					}
					case InfoKind.ReferenceInfo: {
						let newObj = <bazCode.ObjectInfo>newVar;
						if (!oldVar) {
							newChange = new ParsedReference(newObj.name, ChangeState.Created);
						}
						else {
							let oldObj = <bazCode.ObjectInfo>oldVar;
							if (oldObj.refersTo.GetFullName() !== newObj.refersTo.GetFullName()) {
								newChange = new ParsedReference(newObj.name, ChangeState.Modified);
							}
						}
						if (newChange) {
							(<ParsedReference>newChange).ref = newObj.refersTo.GetFullName();
						}
						if (newChange && newObj.owner) {
							newChange.owner = newObj.owner.GetFullName();
						}

						break;
					}
					default: {
						ErrorLog(`CompareVariables: variable has incorrect kind: ${newVar.kind}`);
					}
				}
				if (newChange && newChange.Modified())
					owner.PushChange(newChange);
				return newChange;
			}
			else {
				//TODO: maybe never
			}
		}
		else if (oldVar){
			let state = ChangeState.Deleted;
			let deletedVariable: ParsedBase | undefined;
			switch (oldVar.kind) {
				case InfoKind.ObjectInfo: {
					let oldObj = <bazCode.ObjectInfo>oldVar;
					let oldInit = oldObj.initializer;
					if (oldInit){
						let initName = oldInit.name;
						if (bzConsts.IsComponentConstructor(initName)){
							deletedVariable = new ParsedComponent(oldObj.name, state);
							if (oldInit.owner) //it should be always
								(<ParsedComponent>deletedVariable).compOwner = oldInit.owner.GetFullName(true);
						} else if (initName === bzConsts.Constructors.NewForm){
							deletedVariable = new ParsedForm(oldObj.name, state);
						}
					}
					if (!deletedVariable){
						deletedVariable = new ParsedObject(oldObj.name, state);
					}
					if (oldObj.owner){
						deletedVariable.owner = oldObj.owner.GetFullName();
					}
					break;
				}
				case InfoKind.FunctionInfo: {
					deletedVariable = new ParsedFunction(oldVar.name, state);
					break;
				}
				case InfoKind.ValueInfo: {
					deletedVariable = new ParsedValue(oldVar.name, undefined, state);
					break;
				}
				case InfoKind.ReferenceInfo: {
					deletedVariable = new ParsedReference(oldVar.name, state);
					break;
				}
				default: {
					ErrorLog(`CompareVariables: variable has incorrect kind: ${oldVar.kind}`);
				}
			}
			if (deletedVariable){
				currentForms.PushChange(deletedVariable);
			}
		}
	}

	export function MakeChanges(oldSource: bazCode.SourceInfo | undefined, newSource: bazCode.SourceInfo, logerror: (msg: string) => void): Forms {
		let result = new Forms('');
		currentForms = result;
		try {
			oldSource = oldSource ? oldSource.Copy() : undefined;
			newSource = newSource.Copy();
			ErrorLog = logerror;
			let oldVars = oldSource ? oldSource.variables : undefined;
			CompareVariableArrays(oldVars, newSource.variables, result);
		}
		catch (e) {
			logerror(e.stack);
		}
		currentForms = <any>undefined;
		return result;
	}

	let currentForms: Forms = <any>undefined;

	let ErrorLog: (msg: string) => void;

}