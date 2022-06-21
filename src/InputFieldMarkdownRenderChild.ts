import {MarkdownRenderChild, TFile} from 'obsidian';
import MetaBindPlugin from './main';
import {Logger} from './utils/Logger';
import {AbstractInputField} from './inputFields/AbstractInputField';
import {InputFieldFactory, InputFieldType} from './inputFields/InputFieldFactory';

export class InputFieldMarkdownRenderChild extends MarkdownRenderChild {
	plugin: MetaBindPlugin;
	metaData: any;
	filePath: string;
	uid: number;
	inputField: AbstractInputField;
	error: string;

	fullDeclaration: string;
	inputFieldType: InputFieldType;
	isBound: boolean;
	bindTargetMetadataField: string;
	file: TFile;

	limitInterval: number;
	intervalCounter: number;
	valueQueue: any[];

	arguments: { name: string, value: any }[];

	constructor(containerEl: HTMLElement, fullDeclaration: string, plugin: MetaBindPlugin, filePath: string, uid: number) {
		super(containerEl);

		//console.log(this, 2)

		this.error = '';
		this.fullDeclaration = fullDeclaration;
		this.filePath = filePath;
		this.uid = uid;
		this.plugin = plugin;

		this.valueQueue = [];
		this.intervalCounter = 0;
		this.limitInterval = window.setInterval(() => this.incrementInterval(), this.plugin.settings.syncInterval);

		try {
			this.parseDeclaration();

			this.inputField = InputFieldFactory.createInputField(this.inputFieldType, {
				inputFieldMarkdownRenderChild: this,
				onValueChanged: this.updateMetaData.bind(this),
			});
		} catch (e) {
			this.error = e.message;
		}

		// console.log(this, 3)
	}

	parseDeclaration() {
		const declarationRegExp: RegExp = new RegExp(/\[.*?\]/);
		let declaration: string = declarationRegExp.exec(this.fullDeclaration)[0];
		declaration = declaration.replace('[', '').replace(']', '');
		let declarationParts: string[] = declaration.split(':');

		let boundTo: string = declarationParts[1] ?? '';
		this.isBound = !!boundTo;

		let inputFieldTypeWithArguments: string = declarationParts[0];
		const inputFieldArgumentsRegExp: RegExp = new RegExp(/\(.*\)/);
		const inputFieldTypeString = inputFieldTypeWithArguments.replace(inputFieldArgumentsRegExp, '');
		this.inputFieldType = InputFieldFactory.getInputFieldType(inputFieldTypeString);
		if (this.inputFieldType === InputFieldType.INVALID) {
			throw Error(`Invalid input field type \'${inputFieldTypeString}\'`);
		}

		this.arguments = [];
		let inputFieldArgumentsRegExpResult = inputFieldArgumentsRegExp.exec(inputFieldTypeWithArguments);
		let inputFieldArgumentsString = inputFieldArgumentsRegExpResult ? inputFieldArgumentsRegExpResult[0] : '';
		if (inputFieldArgumentsString) {
			this.parseArguments(inputFieldArgumentsString);
		}

		if (this.isBound) {
			this.parseBindTarget(boundTo);
		}
	}

	parseArguments(inputFieldArgumentsString: string) {
		const inputFieldArgumentsRegExp: RegExp = new RegExp(/\(.*\)/);

		inputFieldArgumentsString = inputFieldArgumentsString.substring(1, inputFieldArgumentsString.length - 1);
		let inputFieldArguments: string[] = inputFieldArgumentsString.split(',');

		inputFieldArguments = inputFieldArguments.map(x => x.trim());
		for (const inputFieldArgument of inputFieldArguments) {
			if (inputFieldArgument.startsWith('class')) {
				let classArgumentsString: string = inputFieldArgumentsRegExp.exec(inputFieldArgument)[0];
				if (!classArgumentsString && classArgumentsString.length >= 2) {
					throw new Error('class needs an argument');
				}
				classArgumentsString = classArgumentsString.substring(1, classArgumentsString.length - 1);
				if (!classArgumentsString) {
					throw new Error('class argument can not be empty');
				}

				let inputFieldStyleArgument: { name: string, value: string } = {name: 'class', value: classArgumentsString};

				this.arguments.push(inputFieldStyleArgument);
			}

			if (inputFieldArgument.startsWith('addLabels')) {
				this.arguments.push({name: 'labels', value: true});
			}
		}
	}

	parseBindTarget(bindTarget: string) {
		let bindTargetParts = bindTarget.split('#');
		if (bindTargetParts.length === 1) { // same file
			this.bindTargetMetadataField = bindTarget;
			const files = this.plugin.getFilesByName(this.filePath);
			if (files.length === 0) {
				this.error = 'file not fond.';
				return;
			} else if (files.length === 1) {
				this.file = files[0];
			} else {
				throw new Error('multiple files found. please specify the file path.');
			}
		} else if (bindTargetParts.length === 2) {
			this.bindTargetMetadataField = bindTargetParts[1];
			const files = this.plugin.getFilesByName(bindTargetParts[0]);
			if (files.length === 0) {
				this.error = 'file not fond.';
				return;
			} else if (files.length === 1) {
				this.file = files[0];
			} else {
				throw new Error('multiple files found. please specify the file path.');
			}
		} else {
			throw new Error('invalid binding.');
		}
		this.metaData = this.plugin.getMetaDataForFile(this.file);
	}

	// use this interval to reduce writing operations
	async incrementInterval() {
		if (this.valueQueue.length > 0) {
			// console.log(this.valueQueue.at(-1))
			await this.plugin.updateMetaData(this.bindTargetMetadataField, this.valueQueue.at(-1), this.file);
			this.valueQueue = [];
		}
	}

	async updateMetaData(value: any) {
		if (this.isBound) {
			this.valueQueue.push(value);
		}
	}

	updateValue(value: any) {
		if (value != null && this.inputField.getValue() !== value && this.valueQueue.length === 0) {
			Logger.logDebug(`updating input field ${this.uid} to '${value.toString()}'`);
			this.inputField.setValue(value);
		}
	}

	getInitialValue() {
		// console.log(this);
		if (this.isBound) {
			return this.metaData[this.bindTargetMetadataField];
		}
	}

	getArgument(name: string) {
		return this.arguments.filter(x => x.name === name).first();
	}

	async onload() {
		Logger.logDebug(this);

		this.metaData = await this.metaData;

		const container = this.containerEl.createDiv();
		container.addClass('meta-bind-plugin-input-wrapper');

		if (this.error) {
			container.innerText = ` -> Error: ${this.error}`;
			container.addClass('meta-bind-plugin-error');
			this.containerEl.appendChild(container);
			return;
		}

		this.plugin.registerMarkdownInputField(this);

		this.inputField.render(container);

		const classArgument = this.getArgument('class');
		if (classArgument) {
			this.inputField.getHtmlElement().addClass(classArgument.value);
		}

		this.containerEl.empty();
		this.containerEl.appendChild(container);
	}

	onunload() {
		this.plugin.unregisterMarkdownInputField(this);

		super.onunload();

		//console.log('unload', this);
		window.clearInterval(this.limitInterval);
	}
}