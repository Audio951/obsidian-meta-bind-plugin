import { MarkdownRenderChild, TFile } from 'obsidian';
import MetaBindPlugin from './main';
import { AbstractInputField } from './inputFields/AbstractInputField';
import { InputFieldFactory } from './inputFields/InputFieldFactory';
import { InputFieldArgumentType, InputFieldDeclaration, InputFieldDeclarationParser } from './parsers/InputFieldDeclarationParser';
import { AbstractInputFieldArgument } from './inputFieldArguments/AbstractInputFieldArgument';
import { ClassInputFieldArgument } from './inputFieldArguments/ClassInputFieldArgument';
import { getFrontmatterOfTFile } from '@opd-libs/opd-metadata-lib/lib/API';
import { traverseObject, validatePath as validateObjectPath } from '@opd-libs/opd-metadata-lib/lib/Utils';
import { MetaBindBindTargetError, MetaBindInternalError } from './utils/MetaBindErrors';

export enum InputFieldMarkdownRenderChildType {
	INLINE_CODE_BLOCK,
	CODE_BLOCK,
}

export class InputFieldMarkdownRenderChild extends MarkdownRenderChild {
	plugin: MetaBindPlugin;
	metaData: any;
	filePath: string;
	uuid: string;
	inputField: AbstractInputField | undefined;
	error: string;
	type: InputFieldMarkdownRenderChildType;

	fullDeclaration: string;
	inputFieldDeclaration: InputFieldDeclaration | undefined;
	bindTargetFile: TFile | undefined;
	bindTargetMetadataField: string | undefined;

	intervalCounter: number;
	metadataValueUpdateQueue: any[];
	inputFieldValueUpdateQueue: any[];

	constructor(containerEl: HTMLElement, type: InputFieldMarkdownRenderChildType, fullDeclaration: string, plugin: MetaBindPlugin, filePath: string, uuid: string) {
		super(containerEl);

		this.error = '';
		this.filePath = filePath;
		this.uuid = uuid;
		this.plugin = plugin;
		this.type = type;
		this.fullDeclaration = fullDeclaration;

		this.metadataValueUpdateQueue = [];
		this.inputFieldValueUpdateQueue = [];
		this.intervalCounter = 0;

		try {
			this.inputFieldDeclaration = InputFieldDeclarationParser.parse(fullDeclaration);

			if (this.inputFieldDeclaration.isBound) {
				this.parseBindTarget();
				this.metaData = getFrontmatterOfTFile(this.bindTargetFile as TFile, this.plugin);
			}

			this.inputField = InputFieldFactory.createInputField(this.inputFieldDeclaration.inputFieldType, {
				type: type,
				inputFieldMarkdownRenderChild: this,
				onValueChanged: this.updateMetadataManager.bind(this),
			});
		} catch (e: any) {
			this.error = e.message;
			console.warn(e);
		}
	}

	parseBindTarget(): void {
		if (!this.inputFieldDeclaration) {
			throw new MetaBindInternalError('inputFieldDeclaration is undefined, can not parse bind target');
		}

		const bindTargetParts = this.inputFieldDeclaration.bindTarget.split('#');
		let bindTargetFileName;
		let bindTargetMetadataFieldName;

		if (bindTargetParts.length === 1) {
			// the bind target is in the same file
			bindTargetFileName = this.filePath;
			bindTargetMetadataFieldName = this.inputFieldDeclaration.bindTarget;
		} else if (bindTargetParts.length === 2) {
			// the bind target is in another file
			bindTargetFileName = bindTargetParts[0];
			bindTargetMetadataFieldName = bindTargetParts[1];
		} else {
			throw new MetaBindBindTargetError("bind target may only contain one '#' to specify the metadata field");
		}

		try {
			validateObjectPath(bindTargetMetadataFieldName);
		} catch (e) {
			if (e instanceof Error) {
				throw new MetaBindBindTargetError(`bind target parsing error: ${e?.message}`);
			}
		}

		this.bindTargetMetadataField = bindTargetMetadataFieldName;

		const files: TFile[] = this.plugin.getFilesByName(bindTargetFileName);
		if (files.length === 0) {
			throw new MetaBindBindTargetError('bind target file not found');
		} else if (files.length === 1) {
			this.bindTargetFile = files[0];
		} else {
			throw new MetaBindBindTargetError('bind target resolves to multiple files, please also specify the file path');
		}
	}

	registerSelfToMetadataManager(): void {
		if (!this.inputFieldDeclaration?.isBound || !this.bindTargetFile || !this.bindTargetMetadataField) {
			return;
		}

		this.plugin.metadataManager.register(
			this.bindTargetFile,
			metadata => {
				if (!this.inputField) {
					throw new MetaBindInternalError('inputField is undefined, can not update inputField');
				}

				const value = traverseObject(this.bindTargetMetadataField as string, metadata);
				if (!this.inputField.isEqualValue(value)) {
					this.inputField.setValue(value);
				}
			},
			this.uuid
		);
	}

	unregisterSelfFromMetadataManager(): void {
		if (!this.inputFieldDeclaration?.isBound || !this.bindTargetFile || !this.bindTargetMetadataField) {
			return;
		}

		this.plugin.metadataManager.unregister(this.bindTargetFile, this.uuid);
	}

	updateMetadataManager(value: any): void {
		if (!this.inputFieldDeclaration?.isBound || !this.bindTargetFile || !this.bindTargetMetadataField) {
			return;
		}

		this.plugin.metadataManager.updatePropertyInMetadataFileCache(value, this.bindTargetMetadataField, this.bindTargetFile, this.uuid);
	}

	getInitialValue(): any | undefined {
		if (this.inputFieldDeclaration?.isBound && this.bindTargetMetadataField) {
			const value = traverseObject(this.bindTargetMetadataField, this.metaData);
			console.debug(`meta-bind | setting initial value to ${value} (typeof ${typeof value}) for input field ${this.uuid}`);
			return value ?? this.inputField?.getDefaultValue();
		}
	}

	getArguments(name: InputFieldArgumentType): AbstractInputFieldArgument[] {
		if (!this.inputFieldDeclaration) {
			throw new MetaBindInternalError('inputFieldDeclaration is undefined, can not retrieve arguments');
		}

		return this.inputFieldDeclaration.argumentContainer.arguments.filter(x => x.identifier === name);
	}

	getArgument(name: InputFieldArgumentType): AbstractInputFieldArgument | undefined {
		return this.getArguments(name).at(0);
	}

	async onload(): Promise<void> {
		console.debug('meta-bind | load inputFieldMarkdownRenderChild', this);

		this.metaData = await this.metaData;

		const container: HTMLDivElement = this.containerEl.createDiv();
		container.addClass('meta-bind-plugin-input-wrapper');
		this.containerEl.addClass('meta-bind-plugin-input');

		if (this.error) {
			this.containerEl.empty();
			this.containerEl.createEl('span', { text: this.fullDeclaration, cls: 'meta-bind-code' });
			container.innerText = ` -> ERROR: ${this.error}`;
			container.addClass('meta-bind-plugin-error');
			this.containerEl.appendChild(container);
			return;
		}

		if (!this.inputField) {
			this.containerEl.empty();
			this.containerEl.createEl('span', { text: this.fullDeclaration, cls: 'meta-bind-code' });
			container.innerText = ` -> ERROR: ${new MetaBindInternalError('input field is undefined and error is empty').message}`;
			container.addClass('meta-bind-plugin-error');
			this.containerEl.appendChild(container);
			return;
		}

		this.registerSelfToMetadataManager();
		this.plugin.registerInputFieldMarkdownRenderChild(this);

		this.inputField.render(container);

		const classArguments: ClassInputFieldArgument[] = this.getArguments(InputFieldArgumentType.CLASS);
		if (classArguments) {
			this.inputField.getHtmlElement().addClasses(classArguments.map(x => x.value).flat());
		}

		this.containerEl.empty();
		this.containerEl.appendChild(container);
	}

	onunload(): void {
		console.debug('meta-bind | unload inputFieldMarkdownRenderChild', this);

		this.plugin.unregisterInputFieldMarkdownRenderChild(this);
		this.unregisterSelfFromMetadataManager();

		super.onunload();
	}
}
