import {
	App,
	Modal,
	debounce,
	ExtraButtonComponent,
	PluginSettingTab,
	Setting,
	TextComponent,
	Notice,
	addIcon,
	normalizePath,
} from "obsidian";
import MarkdownToFoundry from "./plugin";
import { isEmpty,debug } from "./utils";
import { Foundry, apiPost_CreateFoundryMacro,LINK_UPDATE_CODE } from "./foundry"; //,LINK_UPDATE_CODE 
import {VERSION_CONSTANTS, VERSION_STRING} from "./versionConstant";

export interface MarkdownToFoundrySettings {
	profileVersion:{
		MAJOR: number,
		MINOR: number,
		PATCH: number
	},
	isDebugOutput: boolean;
	attributeList: string[];
	classList: string[];
	isActiveProfile: boolean;
	rulesForTags: string[][];
	rulesForRegex: string[][];
	jsCode: string;
	exportDirty: boolean;
	exportFile: boolean;
	isExportVaultPaths: boolean;
	htmlPictureExportFilePath:string;
	htmlPictureRelativeExportFilePath: string;
	exportClipboard: boolean;
	internalLinkResolution: boolean;
	htmlExportFilePath: string; //file path for hmtl export file
	htmlLinkPath: string;
	encodePictures: boolean; // Setting if image encoding shall take place
	removeFrontmatter: boolean; // Setting for removing frontmatter
	assetSaveRuleset: string[][]; // NOT implemented yet
	excludeFoldersByregex: string; //NOT implemented yet
	footerAndHeader: {
		clipboard: string[];
		fileHTML: string[];
		foundryHTML: string[];
	}; //setting for a footer and header which might include css to be added to html as last step
	exportFoundry: boolean; // flag for discerning if a foundry export shall take place
	foundryApiKey: string; // api key for foundry export
	foundryRelayServer: string; // ip or url for foundry relay server
	foundryHeadlessUsed: boolean;
	foundryUser: string;
	foundryPW: string; //
	foundryWorld: string;
	foundryIP: string;
	foundryClientId: string;
	foundrySettingsUsed: boolean; // flag if specific foundry export settings shall be used
	foundryFolder: string; //standard foundry export folder
	foundryJournal: string; //standard foundry Journal entry
	foundryPicturePath: string; // standard save path for pictures
	foundryMacroLinkingRun: boolean;
	ObsidianWriteFrontmatter: boolean; // flag for discerning if frontmatter entries shall be read and written back into obsidian pages
	foundryFrontmatterWriteBack:{		
		isWriteBack:boolean;
		Folder: boolean;
		Journal: boolean;
		PageTitle: boolean;
		Page: boolean;
		PicturePath: boolean;
		UUID: boolean;
	};

}

export interface ProfileSettings {
	[profileName: string]: MarkdownToFoundrySettings;
}

export const DEFAULT_SETTINGS: ProfileSettings = {
	default: {
		profileVersion:{
		MAJOR: VERSION_CONSTANTS.MAJOR,
		MINOR: VERSION_CONSTANTS.MINOR,
		PATCH: VERSION_CONSTANTS.PATCH
		},
		isDebugOutput: false,
		attributeList: ["id", "href", "src", "width", "height", "alt", "colspan", "rowspan"],
		classList: [],
		isActiveProfile: true,
		rulesForTags: [["div", "p"]],
		rulesForRegex: [["", "", ""]], // Default regex rules, can be empty or filled with initial rules
		jsCode: "",
		exportDirty: false,
		exportFile: false,
		isExportVaultPaths: false,
		htmlPictureExportFilePath:"",
		htmlPictureRelativeExportFilePath:"",
		exportClipboard: true,
		exportFoundry: false,
		internalLinkResolution: false,
		htmlExportFilePath: "",
		htmlLinkPath:"",
		encodePictures: true, // Default value for image encoding
		removeFrontmatter: true, // Default value for removing frontmatter
		foundryApiKey: "",
		foundryRelayServer: "https://foundryvtt-rest-api-relay.fly.dev",
		assetSaveRuleset: [["", ""]],
		foundryHeadlessUsed: false,
		foundryUser: "Gamemaster",
		foundryPW: "",
		foundryWorld: "",
		foundryClientId: "",
		foundryIP: "",
		excludeFoldersByregex: "",
		footerAndHeader: {
			clipboard: ["", ""],
			fileHTML: ["", ""],
			foundryHTML: ["", ""],
		},
		foundrySettingsUsed: false,
		foundryFolder: "Obsidian Export",
		foundryJournal: "Obsidian",
		foundryPicturePath: "assets/pictures",
		foundryMacroLinkingRun: false,
		ObsidianWriteFrontmatter: false,
		foundryFrontmatterWriteBack:{		
			isWriteBack:false,
			Folder: false,
			Journal: false,
			PageTitle: false,
			Page: false,
			PicturePath: false,
			UUID: false,
	}
	},
	Foundry_export: {
	profileVersion:{
		MAJOR: VERSION_CONSTANTS.MAJOR,
		MINOR: VERSION_CONSTANTS.MINOR,
		PATCH: VERSION_CONSTANTS.PATCH
		},
	isDebugOutput: false,
    attributeList: [
      "alt",
      "colspan",
      "data-callout",
      "data-callout-fold",
      "data-callout-metadata",
      "data-heading",
      "height",
      "href",
      "open",
      "rowspan",
      "src",
      "width"
    ],
    "classList": [
      "callout"
    ],
    isActiveProfile: true,
    rulesForTags: [
      [
        "div[data-callout=\"secret\"]",
        "section"
      ],
      [
        "div.callout-title",
        "summary"
      ],
      [
        "div.callout",
        "details"
      ],
      [
        "div.callout-title-inner",
        "span"
      ],
      [
        "svg.lucide-copy",
        ""
      ],
      [
        "svg",
        ""
      ],
      [
        "a.tag",
        ""
      ],
      [
        "span[alt]",
        "p"
      ]
    ],
    rulesForRegex: [
      [
        "data-callout-fold=\"\"/gm",
        "open"
      ],
      [
        "data-callout-fold=\"\\+\"/gm",
        "open"
      ],
      [
        "data-callout-fold=\"\\-\"/gm",
        ""
      ],
      [
        "<section[^>]*data-callout=\"secret\"[^>]*class=\"callout\"[^>]*>\\s*<summary>(.*?)<\\/summary>/g",
        "<section  class=\"secret\">"
      ],
      [
        "data-heading=\"([^\"]*<font\\s+color=[^>]+>[^<]*<\\/font>[^\"]*)\"/gm",
        ""
      ]
    ],
    jsCode: "const newHtml = html.replace(/class=\"secret\"/g, function(match) {\n  const newId = api.createID();  // Called once per match ✅\n  return `class=\"secret\" id=\"secret-${newId}\"`;\n});\nreturn newHtml",
    exportDirty: false,
    exportFile: false,
	isExportVaultPaths: false,
	htmlPictureExportFilePath:"",
	htmlPictureRelativeExportFilePath:"",
    exportClipboard: true,
    exportFoundry: true,
    internalLinkResolution: true,
    htmlExportFilePath: "",
	htmlLinkPath:"",
    encodePictures: false,
    removeFrontmatter: true,
    foundryApiKey: "",
    foundryRelayServer: "https://foundryvtt-rest-api-relay.fly.dev",
    assetSaveRuleset: [
      [
        "",
        ""
      ]
    ],
    foundryHeadlessUsed: false,
    foundryUser: "Gamemaster",
    foundryPW: "",
    foundryWorld: "",
    foundryClientId: "",
    foundryIP: "",
    excludeFoldersByregex: "",
    footerAndHeader: {
		clipboard: ["",""],
		fileHTML: ["",""],
		foundryHTML: ["",""],
	},
    foundrySettingsUsed: false,
    foundryFolder: "Obsidian Export",
    foundryJournal: "Obsidian",
    foundryPicturePath: "assets/pictures",
    foundryMacroLinkingRun: true,
    ObsidianWriteFrontmatter: false,
	foundryFrontmatterWriteBack:{		
		isWriteBack:false,
		Folder: false,
		Journal: false,
		PageTitle: false,
		Page: false,
		PicturePath: false,
		UUID: false,
	}
  }
};

export class MarkdownToFoundrySettingsTab extends PluginSettingTab {
	public plugin: MarkdownToFoundry;
	private _allProfileData: ProfileSettings; //dataset with all profiles
	private _activeProfileData: MarkdownToFoundrySettings; //active profile data;
	private activeProfileName: string; //holds the name of the active profile
	private platform: string;

	constructor(app: App, plugin: MarkdownToFoundry) {
		super(app, plugin);
		this.loadSettings();
		this.plugin = plugin;
		this.platform = process.platform;//returns the platform the plugin is running on - can be linux,darwin,win32
		//this._activeProfileData = this._allProfileData['default'];
	}

	get activeProfileData(): MarkdownToFoundrySettings {
		//this._activeProfileData=DEFAULT_SETTINGS['default']; == Improve by checking if active profile exists and else set default
		return this._allProfileData[this.activeProfileName];
	}

	get allProfileData(): ProfileSettings {
		//let activeProfile: string = 'default';
		//this._activeProfileData = this._allProfileData[activeProfile];
		return this._allProfileData;
	}

	//set a new active profile by giving the new name of the profile
	set activateProfile(profileToActivate: string) {
		//check if profile to activate exists
		const canBeActivated = Object.keys(this._allProfileData).contains(profileToActivate) ?? false;
		const currentActiveProfile: string =
			Object.keys(this._allProfileData).find(key => this._allProfileData[key].isActiveProfile === true) || "";

		if (currentActiveProfile === "" && !canBeActivated) {
			const firstNameInList = Object.keys(this._allProfileData)[0];
			this._allProfileData[firstNameInList].isActiveProfile = true;
			this.activeProfileName = firstNameInList;
		}

		if (currentActiveProfile && !canBeActivated) {
			this._activeProfileData = this._allProfileData[currentActiveProfile];
			this.activeProfileName = currentActiveProfile;
			this._allProfileData[currentActiveProfile].isActiveProfile = true;
		}

		if (currentActiveProfile === "" && canBeActivated) {
			//currentActiveProfile =  Object.keys(this._allProfileData)[0]; //stop
			this._activeProfileData = this._allProfileData[profileToActivate];
			this.activeProfileName = profileToActivate;
			this._allProfileData[profileToActivate].isActiveProfile = true;
		}

		if (currentActiveProfile !== "" && canBeActivated) {
			this._activeProfileData = this._allProfileData[profileToActivate];
			this.activeProfileName = profileToActivate;
			this._allProfileData[profileToActivate].isActiveProfile = true;
			this._allProfileData[currentActiveProfile].isActiveProfile = false;
		}
		
		
		debug.log("New active Profile", this.activeProfileName);
		debug.setDebugMode(this.activeProfileData.isDebugOutput);
		
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h1", { text: `MarkdownToFoundry - v${VERSION_STRING}`});
		new Setting(this.containerEl)
			.setName("Enable debug output")
			.setDesc("Whether debug output should be enabled.")
			.addToggle(toggle => {
				toggle.setValue(this.activeProfileData?.isDebugOutput ?? true);
				toggle.onChange(async value => {
					if (value) {
						this.activeProfileData.isDebugOutput = true;
						debug.setDebugMode(true);
						this.save();
						this.display();
					} else {
						this.activeProfileData.isDebugOutput = false;
						debug.setDebugMode(false);
						this.save();
						this.display();
					}
				});
			});
		//profile dropdown for profiles selection
		new Setting(containerEl).setHeading().setName("Profile management");
		new Setting(containerEl)
			.setName("Active Profile")
			.setDesc("Select active profile to be used from the dropdown").addDropdown(dropdown => {
				let dropdownList: string[] = Object.keys(this._allProfileData).sort(); // sort all profile names/keys and store them in an array
				for (let i = 0; i < dropdownList.length; i++) {
					//Just builds the dropdown list with the profile names to display
					dropdown.addOption(dropdownList[i], dropdownList[i]);
				}
				// Set the current value from settings
				dropdown.setValue(this.activeProfileName); // Name of the active Profile
				// Handle onChange event (deleted async)
				dropdown.onChange((value: string) => {
					this.activateProfile = value;
					this.save(); // Save the settings and the new active profile
					this.display(); //refresh the settings tab to show the new active profile
				});
			}); //End of dropdown

			// Existing profile management
		new Setting(containerEl);
		this.newListSetting(
			containerEl,
			"Existing profiles",
			"Add a profile or remove a profile.",
			"Add a profile",
			() => Object.keys(this._allProfileData).sort(),
			true
		);

		//Name for clone profile generation
		if (!this.activeProfileData.exportDirty) {
			//IF block to check if dirty export is enabled

			const newCloneProfileName = new Setting(this.containerEl);
			newCloneProfileName.setName("Clone profile");
			newCloneProfileName.setDesc(
				"If a name is supplied a clone profile with all settings of the current selected profile will be generated."
			);
			newCloneProfileName.addText(text => {
				text.inputEl.style.minWidth = "40ch";
				text.setPlaceholder("Enter a new profile name...");
				text.setValue("");
				text.inputEl.addEventListener("change", () => {
					if (!this.activeProfileData.exportDirty && text.inputEl.value !== "") {
						// create a new cloned profile with the name from the input field
						this._allProfileData[text.inputEl.value] = {
							profileVersion:{
								MAJOR: this.activeProfileData.profileVersion.MAJOR,
								MINOR: this.activeProfileData.profileVersion.MINOR,
								PATCH: this.activeProfileData.profileVersion.PATCH
							},
							isDebugOutput: this.activeProfileData.isDebugOutput,
							attributeList: Array.from(this.activeProfileData.attributeList),
							classList: Array.from(this.activeProfileData.classList),
							isActiveProfile: false,
							rulesForTags: Array.from(this.activeProfileData.rulesForTags),
							rulesForRegex: Array.from(this.activeProfileData.rulesForRegex),
							jsCode: this.activeProfileData.jsCode,
							exportDirty: false, // Default value for dirty export
							exportFile: this.activeProfileData.exportFile,
							isExportVaultPaths: this.activeProfileData.isExportVaultPaths,
							htmlPictureExportFilePath: this.activeProfileData.htmlPictureExportFilePath,
							htmlPictureRelativeExportFilePath: this.activeProfileData.htmlPictureRelativeExportFilePath,
							exportClipboard: this.activeProfileData.exportClipboard,
							exportFoundry: this.activeProfileData.exportFoundry,
							internalLinkResolution: this.activeProfileData.internalLinkResolution,
							htmlExportFilePath: this.activeProfileData.htmlExportFilePath,
							htmlLinkPath: this.activeProfileData.htmlLinkPath,
							encodePictures: this.activeProfileData.encodePictures, // Default value for image encoding
							removeFrontmatter: this.activeProfileData.removeFrontmatter, // Default value for removing frontmatter
							foundryApiKey: this.activeProfileData.foundryApiKey,
							foundryRelayServer: this.activeProfileData.foundryRelayServer,
							assetSaveRuleset: Array.from(this.activeProfileData.assetSaveRuleset),
							foundryHeadlessUsed: this.activeProfileData.foundryHeadlessUsed,
							foundryUser: this.activeProfileData.foundryUser,
							foundryPW: this.activeProfileData.foundryPW,
							foundryWorld: this.activeProfileData.foundryWorld,
							foundryClientId: this.activeProfileData.foundryClientId,
							foundryIP: this.activeProfileData.foundryIP,
							excludeFoldersByregex: this.activeProfileData.excludeFoldersByregex,
							footerAndHeader:{ 
								clipboard: [this.activeProfileData.footerAndHeader.clipboard[0], this.activeProfileData.footerAndHeader.clipboard[1]],
								fileHTML: [this.activeProfileData.footerAndHeader.fileHTML[0], this.activeProfileData.footerAndHeader.fileHTML[1]],
								foundryHTML: [this.activeProfileData.footerAndHeader.foundryHTML[0], this.activeProfileData.footerAndHeader.foundryHTML[1]]
							},
							foundrySettingsUsed: this.activeProfileData.foundrySettingsUsed,
							foundryFolder: this.activeProfileData.foundryFolder,
							foundryJournal: this.activeProfileData.foundryJournal,
							foundryPicturePath: this.activeProfileData.foundryPicturePath,
							foundryMacroLinkingRun: this.activeProfileData.foundryMacroLinkingRun,
							ObsidianWriteFrontmatter: this.activeProfileData.ObsidianWriteFrontmatter,
							foundryFrontmatterWriteBack:{		
								isWriteBack:this.activeProfileData.foundryFrontmatterWriteBack.isWriteBack,
								Folder: this.activeProfileData.foundryFrontmatterWriteBack.Folder,
								Journal: this.activeProfileData.foundryFrontmatterWriteBack.Journal,
								PageTitle: this.activeProfileData.foundryFrontmatterWriteBack.PageTitle,
								Page: this.activeProfileData.foundryFrontmatterWriteBack.Page,
								PicturePath: this.activeProfileData.foundryFrontmatterWriteBack.PicturePath,
								UUID: this.activeProfileData.foundryFrontmatterWriteBack.UUID,
							}
						};
						this.activateProfile = text.inputEl.value;
					}
					this.save();
					this.display();
				});
			});
		}

		// HTML export SECTION
		new Setting(containerEl).setHeading().setName("Clipboard export settings");
		//Clippboard export
		new Setting(this.containerEl)
			.setName("Clippboard export")
			.setDesc("Whether the HTML should be exported to the clippboard. The data-heading class is needed for anchor links to work.")
			.addToggle(toggle => {
				toggle.setValue(this.activeProfileData.exportClipboard);
				toggle.onChange(async value => {
					if (value) {
						this.activeProfileData.exportClipboard = true;
						this.save();
					} else {
						this.activeProfileData.exportClipboard = false;
						this.save();
					}
				});
			});

					//Header and footer text
			new Setting(containerEl)
				.setName("Header and footers for clipboard export")
				.setDesc(
					`The exported HTML is stripped to the core. This allows you to add text before and after the HTML (like body tags and style tags). Make sure it is valid HTML.`
				)
				.addButton(button =>
					button
						.setIcon("file-code")
						.setTooltip("Add header and footer")
						.onClick(() => {
							/*
							let arrayForModal: string[][] = this.activeProfileData.rulesForRegex;
							if (arrayForModal === undefined) {
								arrayForModal = this._activeProfileData.rulesForRegex;
							}*/

							// Create new modal
							const modal = new FooterHeaderModal(this.app, this.activeProfileData.footerAndHeader.clipboard[0],this.activeProfileData.footerAndHeader.clipboard[1], result => {
								// Store the result (tuple of two strings) in the array
								if (result[0]) {
									this.activeProfileData.footerAndHeader.clipboard[0] = result[0];
								}
								if (result[1]) {
									this.activeProfileData.footerAndHeader.clipboard[1] = result[1];
								}
								this.save();
							});
							modal.open();
						})
				);

		// File export
		new Setting(containerEl).setHeading().setName("HTML file export settings");
			new Setting(containerEl)
				.setName("Header and footers for HTML file export")
				.setDesc(
					`The exported HTML is stripped to the core. This allows you to add text before and after the HTML (like body tags and style tags). Make sure it is valid HTML.`
				)
				.addButton(button =>
					button
						.setIcon("file-code")
						.setTooltip("Add header and footer")
						.onClick(() => {
							/*
							let arrayForModal: string[][] = this.activeProfileData.rulesForRegex;
							if (arrayForModal === undefined) {
								arrayForModal = this._activeProfileData.rulesForRegex;
							}*/

							// Create new modal
							const modal = new FooterHeaderModal(this.app,this.activeProfileData.footerAndHeader.fileHTML[0],this.activeProfileData.footerAndHeader.fileHTML[1], result => {
								// Store the result (tuple of two strings) in the array
								if (result[0]) {
									this.activeProfileData.footerAndHeader.fileHTML[0] = result[0];
								}
								if (result[1]) {
									this.activeProfileData.footerAndHeader.fileHTML[1] = result[1];
								}
								this.save();
							});
							modal.open();
						})
				);
		new Setting(this.containerEl)
			.setName("File export")
			.setDesc("Whether the HTML should be exported to a file. The data-heading class is needed for anchor links.")
			.addToggle(toggle => {
				toggle.setValue(this.activeProfileData.exportFile);
				toggle.onChange(async value => {
					if (value) {
						this.activeProfileData.exportFile = true;
						this.save();
						this.display();
					} else {
						this.activeProfileData.exportFile = false;
						this.save();
						this.display();
					}
				});
			});

		//File path for file export
		if (this.activeProfileData.exportFile) {
			//Toggle for file export
			const filePathInput = new Setting(this.containerEl);
			filePathInput.setName("File path to export HTML file to");
			filePathInput.setDesc("The file path to export to. Please make sure your input is correct.");
			if (this.activeProfileData.exportFile) {
				filePathInput.addText(text => {
					text.inputEl.style.minWidth = "40ch";
					text.setPlaceholder("Enter path...");
					text.setValue(this.activeProfileData.htmlExportFilePath);
					text.inputEl.addEventListener("change", () => {
						this.activeProfileData.htmlExportFilePath = text.inputEl.value;
						this.save();
						this.display();
					});
				});
			}

			const linkPathInput = new Setting(this.containerEl);
			linkPathInput.setName("File linking path");
			linkPathInput.setDesc("The (relative) path the hmtl file links should be linked to. For Windows use the path without the drive letter to get relative drive letter independent linking. If left empty the absolute export paths will be used. Please make sure your input is correct.");
			if (this.activeProfileData.exportFile) {
				linkPathInput.addText(text => {
					text.inputEl.style.minWidth = "40ch";

					if(this.platform === "win32"){
						text.setPlaceholder(`${normalizePath(this.activeProfileData.htmlExportFilePath.slice(2))}`);
					} else {
						text.setPlaceholder(`${normalizePath(this.activeProfileData.htmlExportFilePath)}`);
					}

					text.setValue(this.activeProfileData.htmlLinkPath);
					text.inputEl.addEventListener("change", () => {
						this.activeProfileData.htmlLinkPath = text.inputEl.value;
						this.save();
					});
				});
			}	
			
			//Toggle for vault tree export
			new Setting(this.containerEl)
			.setName("Keep vault path structure")
			.setDesc(
				"Whether the vault structure should be mirrored into the output path."
			)
			.addToggle(toggle => {
				toggle.setValue(this.activeProfileData.isExportVaultPaths);
				toggle.onChange(async value => {
					if (value) {
						this.activeProfileData.isExportVaultPaths = true;
						this.save();
						this.display();
					} else {
						this.activeProfileData.isExportVaultPaths = false;
						this.save();
						this.display();
					}
				});
			});

			//Path for picture export
			const htmlPicturePathInput = new Setting(this.containerEl);
			htmlPicturePathInput.setName("File path to export PICTURE file to");
			htmlPicturePathInput.setDesc("The file path to export pictures belonging to the html to. An empty field will save the pictures into the html file filepath. Please make sure your input is correct.");
			if (this.activeProfileData.exportFile) {
				htmlPicturePathInput.addText(text => {
					text.inputEl.style.minWidth = "40ch";
					text.setPlaceholder("Enter picture path...");
					text.setValue(this.activeProfileData.htmlPictureExportFilePath);
					text.inputEl.addEventListener("change", () => {
						this.activeProfileData.htmlPictureExportFilePath = text.inputEl.value;
						this.save();
						this.display();
					});
				});
			}

			const htmlPictureRelativePathInput = new Setting(this.containerEl);
			htmlPictureRelativePathInput.setName("Relative PICTURE linking path");
			htmlPictureRelativePathInput.setDesc('The (relative) path the pictures should be linked to. For an empty picture EXPORT file path use "/" to get relative linking. Else use the a sub path of your html export to point to the picture export folder. Leaving this empty will keep using absolute paths. Please make sure your input is correct.');
			if (this.activeProfileData.exportFile) {
				htmlPictureRelativePathInput.addText(text => {
					text.inputEl.style.minWidth = "40ch";

				let remindingRelativePath ="/"
				//if (this.activeProfileData.htmlPictureRelativeExportFilePath){ // change to relative file paths if they are set
            		const pictureFileExportPath = normalizePath(this.activeProfileData.htmlPictureExportFilePath); // full path    
            		const htmlFileExportPath = normalizePath(this.activeProfileData.htmlExportFilePath); //prefix	
					if (pictureFileExportPath.startsWith(htmlFileExportPath)){
            			remindingRelativePath = pictureFileExportPath.startsWith(htmlFileExportPath) ? pictureFileExportPath.slice(htmlFileExportPath.length) : pictureFileExportPath; // remaining suffix
					}
					if(remindingRelativePath.length === 0){
						remindingRelativePath ="/"
					}
				//}
				
				text.setPlaceholder(`${remindingRelativePath}`);

				/*
					if(this.platform === "win32"){
						text.setPlaceholder(`/ or ${normalizePath(this.activeProfileData.htmlPictureExportFilePath.slice(2))}`);
					} else {
						text.setPlaceholder(`/ or ${normalizePath(this.activeProfileData.htmlPictureExportFilePath)}`);
					}*/

					text.setValue(this.activeProfileData.htmlPictureRelativeExportFilePath);
					text.inputEl.addEventListener("change", () => {
						this.activeProfileData.htmlPictureRelativeExportFilePath = text.inputEl.value;
						this.save();
					});
				});
			}	


		}

		//Toggle for dirty export
		new Setting(this.containerEl)
			.setName("Dirty export")
			.setDesc(
				"Whether an export should take place where classes and attributes are not removed. This will ignore every other setting like class, attribute, rules and detailed rules settings and export the Obsidian representation."
			)
			.addToggle(toggle => {
				toggle.setValue(this.activeProfileData.exportDirty);
				toggle.onChange(async value => {
					if (value) {
						this.activeProfileData.exportDirty = true;
						this.save();
						this.display();
					} else {
						this.activeProfileData.exportDirty = false;
						this.save();
						this.display();
					}
				});
			});

		/* TODO: implement - DISABLED FOR NOW: 
		//Name for dirty profile generation
		//IF block to check if dirty export is enabled
		if (this.activeProfileData.exportDirty) {
			const newDirtyProfileName = new Setting(this.containerEl);
			newDirtyProfileName.setName("New dirty profile name (==NOT IMPLEMENTED YET==)");
			newDirtyProfileName.setDesc(
				"If a name is supplied a dirty profile with all attributes will be added when the add button is pressed."
			);
			newDirtyProfileName.addText(text => {
				text.inputEl.style.minWidth = "40ch";;
				text.setPlaceholder("Enter a new profile name...");
				text.setValue("");
				text.inputEl.addEventListener("change", () => {
					//To be implemented yet - code has to export html in dirty and collect all attributes and classes
					//call dirty html render function
					// function to collect all attributes ==> to return an array
					//function to collect all classes ==> to retunr an array
					console.log("Planned function not yet implemented")
					//this.save();
					//this.display();
				});
			});
		} // End of dirty profile name
		*/
		if (!this.activeProfileData.exportDirty) {
			//if the profile is not a dirty profile all else will be displayed

			//attribute setting
			new Setting(containerEl).setHeading().setName("Attributes");
			this.newListSetting(
				containerEl,
				"Attributes to keep",
				"Add attribute name(s) you want to keep when rendering Markdown to HTML.",
				"Add attribute to keep",
				() => this._activeProfileData.attributeList.sort()
				// The getter function "settings" accesses this._activeProfileData and can be used like a property
				// this is inherenttly given by the keywoard get
				// so in effect there stands this._activeProfileData.attributeList.sort()
				//
			);

			// reset attributes button
			new Setting(containerEl)
				.setName("Reset attributes")
				.setDesc(
					`It is recommended to keep the default attributes. In case you accidentaly deleted some or all of them, you can reset them to the default values (${DEFAULT_SETTINGS.default.attributeList.join(", ")}).`
				)
				.addButton(button =>
					button
						.setIcon("list-restart")
						.setTooltip("Reset attributes to default")
						.onClick(() => {
							//check first for default profile exists and was not deleted
							if (this.activeProfileData === undefined) {
								this._allProfileData["default"] = DEFAULT_SETTINGS["default"];
								this._allProfileData["default"].isActiveProfile = true;
								this.activeProfileName = "default";
							}
							this.activeProfileData.attributeList = Array.from(DEFAULT_SETTINGS.default.attributeList);
							this.save();
							this.display();
						})
				);

			
			//classes selection
			new Setting(containerEl).setHeading().setName("Classes");
			this.newListSetting(
				containerEl,
				"Classes to keep",
				"Add class name(s) you want to keep when rendering Markdown to HTML.",
				"Add class to keep",
				() => this._activeProfileData.classList.sort()
			);
			// reset button for classes selection
			new Setting(containerEl)
				.setName("Reset classes to keep")
				.setDesc(`If you want a clean export just press this button.`)
				.addButton(button =>
					button
						.setIcon("list-restart")
						.setTooltip("Removes all classes from Profile")
						.onClick(() => {
							//check first for default profile exists and was not deleted
							if (this.activeProfileData === undefined) {
								this._allProfileData["default"] = DEFAULT_SETTINGS["default"];
								this._allProfileData["default"].isActiveProfile = true;
								this.activeProfileName = "default";
							}
							this.activeProfileData.classList = [];
							this.save();
							this.display();
						})
				);

			//SECTION for rule based replacement
			new Setting(containerEl).setHeading().setName("Rule based replacements");
			//Button for Modal and tag replacement rules
			new Setting(containerEl)
				.setName("HTML tag replacement")
				.setDesc(
					`This allows you to set up rules to replace HTML tags during export. The rules set up here run as the first step in the export.`
				)
				.addButton(button =>
					button
						.setIcon("code-xml")
						.setTooltip("Add tag replacement rules")
						.onClick(() => {
							const arrayForModal: string[][] = this.activeProfileData.rulesForTags;
							// Create modal object
							const modal = new RuleEditorModal(
								this.app,
								arrayForModal,
								updatedRulesArray => {
									this.activeProfileData.rulesForTags = updatedRulesArray;
									this.save();
									this.display();
								},
								"The first column holds the rule how to find the DOM element (div or div.classname/div[attributeName] - use query selector syntax). The second column holds the new element name (for example 'span' or 'p')."
							);
							modal.open();
						})
				);
			// regex replacement rulset
			new Setting(containerEl)
				.setName("Regex replacement rules")
				//.setDesc(`This allows you to add regex rules. The rules set up here run as a second step in the export.  (== Dropdown values are NOT implemented yet - ignore them for now! ==)`)
				.setDesc(`This allows you to add regex rules. The rules set up here run as a second step in the export.`)
				.addButton(button =>
					button
						.setIcon("regex")
						.setTooltip("Add regex rules")
						.onClick(() => {
							let arrayForModal: string[][] = this.activeProfileData.rulesForRegex;
							if (arrayForModal === undefined) {
								arrayForModal = this._activeProfileData.rulesForRegex;
							}
							// Create new modal
							const modal = new RuleEditorModal(
								this.app,
								arrayForModal,
								updatedRulesArray => {
									this.activeProfileData.rulesForRegex = updatedRulesArray;
									this.save();
									this.display();
								},
								"The first column is your regex expression. You need to enter it with global flags like /gm (so 'regexPattern/gm'). The second column holds the replacement string.",
								//TODO: for now disabled ["Inner and Outer", "InnerHTML", "OuterHTML"] // Dropdown values for the second column
							);
							modal.open();
						})
				);
			// Javascript execution 
			new Setting(containerEl)
				.setName("Javascript replacements")
				.setDesc(
					`This will evaluate your javascript function and execute it on the HTML (string)`
				)
				.addButton(button =>
					button
						.setIcon("braces")
						.setTooltip("{do something with javscript} return html")
						.onClick(() => {
							let jsForModal: string = this.activeProfileData.jsCode;
							if (jsForModal === undefined) {
								jsForModal = this._activeProfileData.jsCode ?? "";
							}
							// Create new modal
							const modal = new jsCodeModal(this.app, this.activeProfileData, result => {
								// Store the result in the jsCode profile property
								if (result) {
									this.activeProfileData.jsCode = result;
								}
								this.save();
							});
							modal.open();
						})
				);

			//Header and footer text
			new Setting(containerEl).setHeading().setName("Detailed export rules");

			//Toggle for internal link resolution
			new Setting(this.containerEl)
				.setName("Wikilink resolution")
				.setDesc("Whether internal wikilinks should be resolved and exported with the Obsidian (relative) vault path.")
				.addToggle(toggle => {
					toggle.setValue(this.activeProfileData.internalLinkResolution);
					toggle.onChange(async value => {
						if (value) {
							this.activeProfileData.internalLinkResolution = true;
							this.save();
						} else {
							this.activeProfileData.internalLinkResolution = false;
							this.save();
						}
					});
				});

			//Toggle for Image encoding
			new Setting(this.containerEl)
				.setName("Image encoding")
				.setDesc("Whether images should be encoded as base64 in the HTML. Do not set this if you export to Foundry VTT!")
				.addToggle(toggle => {
					toggle.setValue(this.activeProfileData.encodePictures);
					toggle.onChange(async value => {
						if (value) {
							this.activeProfileData.encodePictures = true;
							this.save();
						} else {
							this.activeProfileData.encodePictures = false;
							this.save();
						}
					});
				});

			//Toggle for Frontmatter removing
			new Setting(this.containerEl)
				.setName("Remove frontmatter")
				.setDesc("Whether frontmatter should be removed from the HTML.")
				.addToggle(toggle => {
					toggle.setValue(this.activeProfileData.removeFrontmatter);
					toggle.onChange(async value => {
						if (value) {
							this.activeProfileData.removeFrontmatter = true;
							this.save();
						} else {
							this.activeProfileData.removeFrontmatter = false;
							this.save();
						}
					});
				});

			//SECTION for FOUNDRY export
			new Setting(containerEl).setHeading().setName("Foundry export settings");
			//toggle foundry section
			new Setting(this.containerEl)
				.setName("Foundry export")
				.setDesc("Whether the HTML should be exported to Foundry by REST call. Make sure you have the Foundry REST API module installed and a Foundry instance running!")
				.addToggle(toggle => {
					toggle.setValue(this.activeProfileData.exportFoundry);
					toggle.onChange(async value => {
						if (value) {
							this.activeProfileData.exportFoundry = true;
							this.save();
							this.display();
						} else {
							this.activeProfileData.exportFoundry = false;
							this.save();
							this.display();
						}
					});
				});
			// api key setting
			if (this.activeProfileData.exportFoundry) {
				new Setting(this.containerEl)
					.setName("API key")
					.setDesc("API key (=password). Please make sure your input is correct.")
					.addText(text => {
						text.inputEl.style.minWidth = "40ch";;
						text.setPlaceholder("Enter API key");
						text.setValue(this.activeProfileData.foundryApiKey);
						text.inputEl.addEventListener("change", () => {
							this.activeProfileData.foundryApiKey = text.inputEl.value;
							this.save();
						});
					});
				// relay server setting
				new Setting(this.containerEl)
					.setName("Relay server IP")
					.setDesc(
						"IP to the relay server. Please make sure your input is correct. Install your own relay server or make an account and try 'foundryvtt-rest-api-relay.fly.dev'."
					)
					.addText(text => {
						text.inputEl.style.width = "300px";
						text.setPlaceholder("http://[IP of the relay server]:3010");
						text.setValue(this.activeProfileData.foundryRelayServer);
						text.inputEl.addEventListener("change", () => {
							this.activeProfileData.foundryRelayServer = text.inputEl.value;
							this.save();
						});
					});
				// Foundry ID
				new Setting(this.containerEl)
					.setName("Foundry session ID")
					.setDesc(
						"Foundry ID of the world to import into. Be aware that this is server+world+user specific. You can find it in the module config. If no ID is specified then the first active world is taken (can be random)."
					)
					.addText(text => {
						//text.inputEl.style.width = "100%";
						text.inputEl.style.minWidth = "25ch"
						text.setPlaceholder("Enter foundry session ID");
						text.setValue(this.activeProfileData.foundryClientId);
						text.inputEl.addEventListener("change", () => {
							this.activeProfileData.foundryClientId = text.inputEl.value;
							this.save();
						});
					});

				//helper Button to get Foundry World ID
				addIcon(
					"help",
					`<g transform="scale(4.1666)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
							<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
							<path d="M12 17h.01"/>
							</g>`
				);
				new Setting(containerEl)
					.setName("Helper to get Foundry session ID")
					.setDesc(
						"This will do a call agains the relay server and list all connected instances."
					)
					.addButton(button =>
						button
							.setIcon("help")
							.setTooltip("Make REST call to get Foundry session ID")
							.onClick(async () => {
								const apiKey = this.activeProfileData.foundryApiKey ?? "";
								let relayServer = this.activeProfileData.foundryRelayServer || DEFAULT_SETTINGS.default.foundryRelayServer || "";
								//TODO: remove unecessary code for relay server check - because you default to hardcoded DEFAULT relay server
								if (!this.activeProfileData?.foundryRelayServer) {
									relayServer = DEFAULT_SETTINGS.default.foundryRelayServer;
								}
								if (!relayServer) {
									throw new Error("NO relay server specified!");
								}
								if (!apiKey) {
									new Notice("NO API key specified!", 5000);
									throw new Error("NO API key specified!");
								}
								const clientList = await Foundry.apiGet_FoundryClientList(relayServer, apiKey);
								if (clientList.length > 0) {
									// Create new modal
									const modal = new FoundrySelectIdModal(this.app, clientList, selected => {
										if (selected) {
											// Handle the selected value
											this.activeProfileData.foundryClientId = selected;
											this.save();
											this.display();
										} else {
											// Handle cancel
										}
									}).open();
								} else {
									new Notice("No connected client could be found.", 4000)
								}
							})
					);
				//SECTION foundry linking export settings
				new Setting(containerEl).setHeading().setName("Foundry journal relinking export settings");

				//Foundry linking macro to clipboard
				new Setting(containerEl)
					.setName("Copy Foundry VTT journal linking macro to clipboard")
					.setDesc(
						"This will copy the journal linking macro to your clipboard only."
					)
					.addButton(button =>
						button
							.setIcon("clipboard-copy")
							.setTooltip("Copies the macro code for journal linking to clipboard")
							.onClick(async () => {
								
								debug.log("Macro copy to clipboard started");
								
							navigator.clipboard
								.writeText(LINK_UPDATE_CODE) //
								.then(() => new Notice("Macro copied to the clipboard", 3500))
								.catch(() => new Notice("Couldn't copy macro to the clipboard", 3500))
							})
					);

				//Foundry linking macro by upload
				new Setting(containerEl)
					.setName("Install Foundry VTT journal linking macro")
					.setDesc(
						"This will install a linking macro into your active Foundry session."
					)
					.addButton(button =>
						button
							.setIcon("markdownToFoundry-icon")
							.setTooltip("Installs the macro code for journal linking in Foundry")
							.onClick(async () => {
								
								debug.log("Macro installation started");
								
								await Foundry.init(this.app, this.activeProfileData)
								const response = await apiPost_CreateFoundryMacro(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer)
							})
					);
				// Automatic journal linking after each export
				new Setting(this.containerEl)
					.setName("Foundry VTT journal linking after every export")
					.setDesc("This will run a journal linking run after each export in the connected Foundry instance if the toggle is set")
					.addToggle(toggle => {
						toggle.setValue(this.activeProfileData.foundryMacroLinkingRun);
						toggle.onChange(async value => {
							if (value) {
								this.activeProfileData.foundryMacroLinkingRun = true;
								this.save();
								this.display();
							} else {
								this.activeProfileData.foundryMacroLinkingRun = false;
								this.save();
								this.display();
							}
						});
					});

				//SECTION headless login
				new Setting(containerEl).setHeading().setName("Foundry headless login settings");
				//headless login toggle
				new Setting(this.containerEl)
					.setName("Foundry headless login")
					.setDesc("Allows to connect and export notes without beeing logged into Foundry (Foundry needs to be running and active!). This setting takes precedence before manual login!")
					.addToggle(toggle => {
						toggle.setValue(this.activeProfileData.foundryHeadlessUsed);
						toggle.onChange(async value => {
							if (value) {
								this.activeProfileData.foundryHeadlessUsed = true;
								this.save();
								this.display();
							} else {
								this.activeProfileData.foundryHeadlessUsed = false;
								this.save();
								this.display();
							}
						});
					});

				// headless foundry server ID
				if (this.activeProfileData.foundryHeadlessUsed) {
					new Setting(this.containerEl)
						.setName("Foundry server IP")
						.setDesc("Sets IP/URL AND PORT of the Foundry server to log in.")
						.addText(text => {
							text.inputEl.style.minWidth = "40ch";
							text.setPlaceholder("Enter IP/URL");
							text.setValue(this.activeProfileData.foundryIP);
							text.inputEl.addEventListener("change", () => {
								this.activeProfileData.foundryIP = text.inputEl.value;
								this.save();
							});
						});
					// headless foundry user
					new Setting(this.containerEl)
						.setName("Foundry User")
						.setDesc("Sets user name to log in with. This should be a gamemaster.")
						.addText(text => {
							text.inputEl.style.minWidth = "40ch";
							text.setPlaceholder("Enter user name");
							text.setValue(this.activeProfileData.foundryUser);
							text.inputEl.addEventListener("change", () => {
								this.activeProfileData.foundryUser = text.inputEl.value;
								this.save();
							});
						});
					// headless foundry user password
					new Setting(this.containerEl)
						.setName("Foundry user password")
						.setDesc("Sets the Foundry password of the user name to log in with.")
						.addText(text => {
							text.inputEl.style.minWidth = "40ch";;
							text.setPlaceholder("Enter user password");
							text.setValue(this.activeProfileData.foundryPW);
							text.inputEl.addEventListener("change", () => {
								this.activeProfileData.foundryPW = text.inputEl.value;
								this.save();
							});
						});
					// headless world title
					new Setting(this.containerEl)
						.setName("Foundry world title")
						.setDesc("Sets world name to log in into. Use the Foundry module or the helper for the session ID to find the world title.")
						.setTooltip("You can also use the Custom Client Name if you have set one.")
						.addText(text => {
							text.inputEl.style.minWidth = "40ch";;
							text.setPlaceholder("Enter world title");
							text.setValue(this.activeProfileData.foundryWorld);
							text.inputEl.addEventListener("change", () => {
								this.activeProfileData.foundryWorld = text.inputEl.value;
								this.save();
							});
						});
				}
				//SECTION foundry standard export settings
				new Setting(containerEl).setHeading().setName("Foundry standard export settings");

				//standard export settings toggle
				new Setting(this.containerEl)
					.setName("Set Foundry standard export settings")
					.setDesc("Sets YOUR standard export folder, journal and picture path. Also if frontmatter shall be used.")
					.addToggle(toggle => {
						toggle.setValue(this.activeProfileData.foundrySettingsUsed);
						toggle.onChange(async value => {
							if (value) {
								this.activeProfileData.foundrySettingsUsed = true;
								this.save();
								this.display();
							} else {
								this.activeProfileData.foundrySettingsUsed = false;
								this.save();
								this.display();
							}
						});
					});
				// standard settings foundry folder
				if (this.activeProfileData.foundrySettingsUsed) {

			new Setting(containerEl)
				.setName("Header and footers for Foundry HTML export")
				.setDesc(
					`The exported HTML is stripped to the core. This allows you to add text before and after the HTML (like body tags and style tags). Make sure it is valid HTML.`
				)
				.addButton(button =>
					button
						.setIcon("file-code")
						.setTooltip("Add header and footer")
						.onClick(() => {
							/*
							let arrayForModal: string[][] = this.activeProfileData.rulesForRegex;
							if (arrayForModal === undefined) {
								arrayForModal = this._activeProfileData.rulesForRegex;
							}*/
							// Create new modal
							const modal = new FooterHeaderModal(this.app, this.activeProfileData.footerAndHeader.foundryHTML[0],this.activeProfileData.footerAndHeader.foundryHTML[1], result => {
								// Store the result (tuple of two strings) in the array
								if (result[0]) {
									this.activeProfileData.footerAndHeader.foundryHTML[0] = result[0];
								}
								if (result[1]) {
									this.activeProfileData.footerAndHeader.foundryHTML[1] = result[1];
								}
								this.save();
							});
							modal.open();
						})
				);

					new Setting(this.containerEl)
						.setName("Foundry folder")
						.setDesc("Sets the standard Foundry VTT export folder.")
						.addText(text => {
							text.inputEl.style.minWidth = "40ch";;
							text.setPlaceholder("Enter foldername");
							text.setValue(this.activeProfileData.foundryFolder);
							text.inputEl.addEventListener("change", () => {
								this.activeProfileData.foundryFolder = text.inputEl.value;
								this.save();
							});
						});
				//standard settings foundry journal		
					new Setting(this.containerEl)
						.setName("Foundry journal")
						.setDesc("Sets the standard Foundry VTT export journal.")
						.addText(text => {
							text.inputEl.style.minWidth = "40ch";;
							text.setPlaceholder("Enter journal name");
							text.setValue(this.activeProfileData.foundryJournal);
							text.inputEl.addEventListener("change", () => {
								this.activeProfileData.foundryJournal = text.inputEl.value;
								this.save();
							});
						});
				//standard settings foundry picture path
					new Setting(this.containerEl)
						.setName("Foundry picture path.")
						.setDesc("Sets the standard Foundry VTT picture export path.")
						.addText(text => {
							text.inputEl.style.minWidth = "40ch";;
							text.setPlaceholder("Enter picture path");
							text.setValue(this.activeProfileData.foundryPicturePath ?? "assets/pictures");
							text.inputEl.addEventListener("change", () => {
								this.activeProfileData.foundryPicturePath = text.inputEl.value;
								this.save();
							});
						});
					
					new Setting(containerEl).setHeading().setName("Frontmatter settings and usage");
					new Setting(this.containerEl)
						.setName("Obsidian frontmatter UUID")
						.setDesc(
							"If set your Obsidian notes will get an Obsidian UUID after first import into foundry."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.ObsidianWriteFrontmatter);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.ObsidianWriteFrontmatter = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.ObsidianWriteFrontmatter = false;
									this.save();
									this.display();
								}
							});
						});
					//SECTION foundry frontmatter settings
				//standard settings foundry frontmatter writeback
					new Setting(this.containerEl)
						.setName("Foundry frontmatter first")
						.setDesc(
							"If set frontmatter will be used first. Else the standard export settings and then the hardcoded defaults will be used. You also can now set which frontmatter will be written back into your note."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.foundryFrontmatterWriteBack.isWriteBack);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.foundryFrontmatterWriteBack.isWriteBack = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.foundryFrontmatterWriteBack.isWriteBack = false;
									this.save();
									this.display();
								}
							});
						});
					
					if (this.activeProfileData.foundryFrontmatterWriteBack.isWriteBack){
					new Setting(this.containerEl)
						.setName("Foundry folder writeback option")
						.setDesc(
							"If set the foundry folder will be written back into your frontmatter after export if not allready set. The frontmatter will be used first then the standard export settings and then the hardcoded defaults will be used."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.foundryFrontmatterWriteBack.Folder);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.foundryFrontmatterWriteBack.Folder = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.foundryFrontmatterWriteBack.Folder = false;
									this.save();
									this.display();
								}
							});
						});
					new Setting(this.containerEl)
						.setName("Foundry journal writeback option")
						.setDesc(
							"If set the foundry journal will be written back into your frontmatter after export if not allready set. The frontmatter will be used first then the standard export settings and then the hardcoded defaults will be used."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.foundryFrontmatterWriteBack.Journal);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.foundryFrontmatterWriteBack.Journal = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.foundryFrontmatterWriteBack.Journal = false;
									this.save();
									this.display();
								}
							});
						});

						new Setting(this.containerEl)
						.setName("Foundry page writeback option")
						.setDesc(
							"If set the foundry page will be written back into your frontmatter after export if not allready set. The frontmatter will be used first then the standard export settings and then the hardcoded defaults will be used."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.foundryFrontmatterWriteBack.Page);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.foundryFrontmatterWriteBack.Page = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.foundryFrontmatterWriteBack.Page = false;
									this.save();
									this.display();
								}
							});
						});

						new Setting(this.containerEl)
						.setName("Foundry page title writeback option")
						.setDesc(
							"If set the foundry folder will be written back into your frontmatter after export if not allready set. The frontmatter will be used first then the standard export settings and then the hardcoded defaults will be used."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.foundryFrontmatterWriteBack.PageTitle);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.foundryFrontmatterWriteBack.PageTitle = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.foundryFrontmatterWriteBack.PageTitle = false;
									this.save();
									this.display();
								}
							});
						});

						new Setting(this.containerEl)
						.setName("Foundry picture path writeback option")
						.setDesc(
							"If set the foundry picture path will be written back into your frontmatter after export if not allready set. The frontmatter will be used first then the standard export settings and then the hardcoded defaults will be used."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.foundryFrontmatterWriteBack.PicturePath);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.foundryFrontmatterWriteBack.PicturePath = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.foundryFrontmatterWriteBack.PicturePath = false;
									this.save();
									this.display();
								}
							});
						});

						new Setting(this.containerEl)
						.setName("Foundry UUID writeback options")
						.setDesc(
							"If set the foundry UUID will be written back into your frontmatter after export if not allready set. The frontmatter will be used first then the standard export settings and then the hardcoded defaults will be used."
						)
						.addToggle(toggle => {
							toggle.setValue(this.activeProfileData.foundryFrontmatterWriteBack.UUID);
							toggle.onChange(async value => {
								if (value) {
									this.activeProfileData.foundryFrontmatterWriteBack.UUID = true;
									this.save();
									this.display();
								} else {
									this.activeProfileData.foundryFrontmatterWriteBack.UUID = false;
									this.save();
									this.display();
								}
							});
						});

					}
						/* disabled for now needs to be implemented
					new Setting(containerEl)
					.setName("Picture folder rules")
					.setDesc(
						`This allows you to set up rules on note properties on where to save pictures in Foundry.==NOT IMPLEMENTED YET==`
					)
					.addButton(button =>
						button
							.setIcon("image")
							.setTooltip("Add picture save location rules.")
							.onClick(() => {
								const arrayForModal: string[][] = this.activeProfileData.rulesForTags;
								// Create modal object
								const modal = new RuleEditorModal(
									this.app,
									arrayForModal,
									updatedRulesArray => {
										//this.activeProfileData.rulesForTags = updatedRulesArray;
										//this.save();
										this.display();
									},
									"The first column holds the regex rule to use on the Obsidian file path. The second column holds the Foundry path."
								);
								modal.open();
							})
					);*/

				} //End of foundry sub settings
			} //End of Foundry settings
		} //End of dirty profile if statement
	} // End of display function

	private newListSetting(
		containerEl: HTMLElement, // Container for the setting
		name: string, // Display name
		desc: string, // Description text
		buttonTooltip: string, // Tooltip for add button
		listContent: (settings: string[]) => string[], // List accessor
		isProfile?: boolean // Optional parameter to check if it is a profile
	) {
		// Create the setting and container
		const setting = new Setting(containerEl).setName(name).setDesc(desc);
		const listDiv = createDiv({ cls: ["setting-command-hotkeys", "mdToFoundry-list"] });
		containerEl.appendChild(listDiv);
		// Initialize input and add event listeners
		let input: TextComponent;
		const addElement = async () => {
			input
				.getValue()
				.split(/[, ]/g)
				.forEach(value => {
					// replace invalid characters
					value = value.replace(/[ ~!@$%^&*()+=,./';:"?><\[\]\\\{\}|`#]/g, "");
					//===>Hier unterscheiden ob es ein profile ist oder nicht ==> erfolgt über den Parameter isProfile
					// add to list if not already in list
					if (!isEmpty(value) && !listContent(Object.keys(this._activeProfileData)).contains(value)) {
						listContent(Object.keys(this._activeProfileData)).push(value);
						if (isProfile) {
							this.addListElement(listDiv, value, listContent, true);
						} else {
							this.addListElement(listDiv, value, listContent);
						}
						if (isProfile) {
							this._allProfileData[value] = DEFAULT_SETTINGS.default;
							//Newly created profile should not be active else you get two active profiles
							this._allProfileData[value].isActiveProfile = false;
							this.display;
						}
						this.containerEl.empty();
						this.display();
						this.save();
						input.setValue("");
					} else {
						input.inputEl.focus();
					}
				});
		};

		setting.addText(text => {
			input = text;
			input.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.preventDefault();
					addElement();
				}
			});
		});
		// Add the plus button
		setting.addExtraButton(button => button.setIcon("plus-circle").setTooltip(buttonTooltip).onClick(addElement));
		// Initialize the list with existing values
		listContent(Object.keys(this._activeProfileData).sort()).forEach(value => {
			this.addListElement(listDiv, value, listContent, isProfile);
		});
	}

	private addListElement(
		containerEl: HTMLElement,
		elementName: string,
		listContent: (settings: string[]) => string[],
		isAprofile?: boolean // Optional parameter to check if it is a profile
	) {
		const elementSpan = createSpan({ cls: "setting-hotkey", parent: containerEl });
		elementSpan.setText(elementName);
		const delBtn = new ExtraButtonComponent(elementSpan);
		delBtn.setIcon("cross");
		delBtn.setTooltip(`Delete '${elementName}' from list`);
		//==> removal of the element from the list
		delBtn.onClick(() => {
			if (listContent(Object.keys(this._activeProfileData)).contains(elementName)) {
				if (isAprofile) {
					//Make sure that if the active profile is deleted a new one is set or a default profile is created
					// for now only check if at least one element remains and set the first element of the remaining list as active
					if (Object.keys(this._allProfileData).length >= 2) {
						//check that there are at least two profiles left
						if ((this.activeProfileName = elementName)) {
							delete this._allProfileData[elementName];
							this.activateProfile = elementName;
						} else {
							delete this._allProfileData[elementName];
						}
						this.containerEl.empty();
					}
					this.display();
				}
				listContent(Object.keys(this._activeProfileData)).remove(elementName);
				this.save();
				elementSpan.remove();
			}
		});
	}

	/**
	 * Load settings on start-up.
	 */
	private async loadSettings() {
		const originalDataJson = await this.plugin.loadData() ?? "{}";
		debug.log("Loaded profile data: ", originalDataJson);
		if (originalDataJson === "{}" || Object.keys(originalDataJson).length === 0) {
			this._allProfileData = DEFAULT_SETTINGS;
			debug.log("No previous profile settings found, loading defaults.",this._allProfileData);
		} else {
			const major = (originalDataJson["default"]?.profileVersion?.MAJOR ?? 0);
			const minor = (originalDataJson["default"]?.profileVersion?.MINOR ?? 0);
			const patch = (originalDataJson["default"]?.profileVersion?.PATCH ?? 0);

			if (major < VERSION_CONSTANTS.MAJOR || minor < VERSION_CONSTANTS.MINOR || patch < VERSION_CONSTANTS.PATCH) {		
				debug.log("Old profile settings found, migrating to new version.");
				this._allProfileData = this.migrateProfile(originalDataJson);
			} else {
				this._allProfileData = originalDataJson;
				debug.log("Profile settings found, using current settings.",this._allProfileData);
				
		}
		
	}
	this.activateProfile = "";
	await this.plugin.saveData(this._allProfileData);
}

	/**
	 * Migrates profiles if a new version of the plugin has been released.
	 */
	private migrateProfile(oldProfileCollection: any){
		let newProfileCollection: ProfileSettings = {};
		let profileNameList: string[] = Object.keys(oldProfileCollection)
		let activeProfileNameCollection: string[] = []
		for (const profileName of profileNameList) {
			if (oldProfileCollection[profileName]?.isActiveProfile) {
				if (profileName !== "default") {
					activeProfileNameCollection.push(profileName)
				}
			}
			// For each profile copy over the old settings and add new settings with default values
			// Also update the version number
			// If old setting does not exist use default value
			// Use optional chaining and nullish coalescing to handle missing properties
			newProfileCollection[profileName] = {
							profileVersion:{
								MAJOR: VERSION_CONSTANTS.MAJOR,
								MINOR: VERSION_CONSTANTS.MINOR,
								PATCH: VERSION_CONSTANTS.PATCH
							},
							isDebugOutput: oldProfileCollection[profileName]?.isDebugOutput ?? DEFAULT_SETTINGS.default.isDebugOutput,
							attributeList: Array.from(oldProfileCollection[profileName]?.attributeList ?? DEFAULT_SETTINGS.default.attributeList),
							classList: Array.from(oldProfileCollection[profileName]?.classList ?? DEFAULT_SETTINGS.default.classList),
							isActiveProfile: false, //We only want one active profile at a time and will determine the correct one later
							rulesForTags: Array.from(oldProfileCollection[profileName]?.rulesForTags ?? DEFAULT_SETTINGS.default.rulesForTags),
							rulesForRegex: Array.from(oldProfileCollection[profileName]?.rulesForRegex ?? DEFAULT_SETTINGS.default.rulesForRegex),
							jsCode: oldProfileCollection[profileName]?.jsCode ?? DEFAULT_SETTINGS.default.jsCode,
							exportDirty: oldProfileCollection[profileName]?.exportDirty ?? DEFAULT_SETTINGS.default.exportDirty,
							exportFile: oldProfileCollection[profileName]?.exportFile ?? DEFAULT_SETTINGS.default.exportFile,
							isExportVaultPaths: oldProfileCollection[profileName]?.isExportVaultPaths ?? DEFAULT_SETTINGS.default.isExportVaultPaths,
							htmlPictureExportFilePath: oldProfileCollection[profileName]?.htmlPictureExportFilePath ?? DEFAULT_SETTINGS.default.htmlPictureExportFilePath,
							htmlPictureRelativeExportFilePath: oldProfileCollection[profileName]?.htmlPictureRelativeExportFilePath ?? DEFAULT_SETTINGS.default.htmlPictureRelativeExportFilePath,
							exportClipboard: oldProfileCollection[profileName]?.exportClipboard ?? DEFAULT_SETTINGS.default.exportClipboard,
							exportFoundry: oldProfileCollection[profileName]?.exportFoundry ?? DEFAULT_SETTINGS.default.exportFoundry,
							internalLinkResolution: oldProfileCollection[profileName]?.internalLinkResolution ?? DEFAULT_SETTINGS.default.internalLinkResolution,
							htmlExportFilePath: oldProfileCollection[profileName]?.htmlExportFilePath ?? DEFAULT_SETTINGS.default.htmlExportFilePath,
							htmlLinkPath: oldProfileCollection[profileName]?.htmlLinkPath ?? DEFAULT_SETTINGS.default.htmlLinkPath,
							encodePictures: oldProfileCollection[profileName]?.encodePictures ?? DEFAULT_SETTINGS.default.encodePictures,
							removeFrontmatter: oldProfileCollection[profileName]?.removeFrontmatter ?? DEFAULT_SETTINGS.default.removeFrontmatter,
							foundryApiKey: oldProfileCollection[profileName]?.foundryApiKey ?? DEFAULT_SETTINGS.default.foundryApiKey,
							foundryRelayServer: oldProfileCollection[profileName]?.foundryRelayServer ?? DEFAULT_SETTINGS.default.foundryRelayServer,
							assetSaveRuleset: Array.from(oldProfileCollection[profileName]?.assetSaveRuleset ?? DEFAULT_SETTINGS.default.assetSaveRuleset),
							foundryHeadlessUsed: oldProfileCollection[profileName]?.foundryHeadlessUsed ?? DEFAULT_SETTINGS.default.foundryHeadlessUsed,
							foundryUser: oldProfileCollection[profileName]?.foundryUser ?? DEFAULT_SETTINGS.default.foundryUser,
							foundryPW: oldProfileCollection[profileName]?.foundryPW ?? DEFAULT_SETTINGS.default.foundryPW,
							foundryWorld: oldProfileCollection[profileName]?.foundryWorld ?? DEFAULT_SETTINGS.default.foundryWorld,
							foundryClientId: oldProfileCollection[profileName]?.foundryClientId ?? DEFAULT_SETTINGS.default.foundryClientId,
							foundryIP: oldProfileCollection[profileName]?.foundryIP ?? DEFAULT_SETTINGS.default.foundryIP,
							excludeFoldersByregex: oldProfileCollection[profileName]?.excludeFoldersByregex ?? DEFAULT_SETTINGS.default.excludeFoldersByregex,
							footerAndHeader:{
								clipboard: [oldProfileCollection[profileName]?.footerAndHeader.clipboard[0] ?? DEFAULT_SETTINGS.default.footerAndHeader.clipboard[0], oldProfileCollection[profileName]?.footerAndHeader.clipboard[1] ?? DEFAULT_SETTINGS.default.footerAndHeader.clipboard[1]],
								fileHTML: [oldProfileCollection[profileName]?.footerAndHeader.fileHTML[0] ?? DEFAULT_SETTINGS.default.footerAndHeader.fileHTML[0], oldProfileCollection[profileName]?.footerAndHeader.fileHTML[1] ?? DEFAULT_SETTINGS.default.footerAndHeader.fileHTML[1]],
								foundryHTML: [oldProfileCollection[profileName]?.footerAndHeader.foundryHTML[0] ?? DEFAULT_SETTINGS.default.footerAndHeader.foundryHTML[0], oldProfileCollection[profileName]?.footerAndHeader.foundryHTML[1] ?? DEFAULT_SETTINGS.default.footerAndHeader.foundryHTML[1]],
							},
							foundrySettingsUsed: oldProfileCollection[profileName]?.foundrySettingsUsed ?? DEFAULT_SETTINGS.default.foundrySettingsUsed,
							foundryFolder: oldProfileCollection[profileName]?.foundryFolder ?? DEFAULT_SETTINGS.default.foundryFolder,
							foundryJournal: oldProfileCollection[profileName]?.foundryJournal ?? DEFAULT_SETTINGS.default.foundryJournal,
							foundryPicturePath: oldProfileCollection[profileName]?.foundryPicturePath ?? DEFAULT_SETTINGS.default.foundryPicturePath,
							foundryMacroLinkingRun: oldProfileCollection[profileName]?.foundryMacroLinkingRun ?? DEFAULT_SETTINGS.default.foundryMacroLinkingRun,
							ObsidianWriteFrontmatter: oldProfileCollection[profileName]?.ObsidianWriteFrontmatter ?? DEFAULT_SETTINGS.default.ObsidianWriteFrontmatter,
							foundryFrontmatterWriteBack:{		
								isWriteBack: oldProfileCollection[profileName]?.foundryFrontmatterWriteBack?.isWriteBack ?? DEFAULT_SETTINGS.default?.foundryFrontmatterWriteBack?.isWriteBack,
								Folder: oldProfileCollection[profileName]?.foundryFrontmatterWriteBack?.Folder ?? DEFAULT_SETTINGS.default?.foundryFrontmatterWriteBack?.Folder,
								Journal: oldProfileCollection[profileName]?.foundryFrontmatterWriteBack?.Journal ?? DEFAULT_SETTINGS.default?.foundryFrontmatterWriteBack?.Journal,
								PageTitle: oldProfileCollection[profileName]?.foundryFrontmatterWriteBack?.PageTitle ?? DEFAULT_SETTINGS.default?.foundryFrontmatterWriteBack?.PageTitle,
								Page: oldProfileCollection[profileName]?.foundryFrontmatterWriteBack?.Page ?? DEFAULT_SETTINGS.default?.foundryFrontmatterWriteBack?.Page,
								PicturePath: oldProfileCollection[profileName]?.foundryFrontmatterWriteBack?.PicturePath ?? DEFAULT_SETTINGS.default?.foundryFrontmatterWriteBack?.PicturePath,
								UUID: oldProfileCollection[profileName]?.foundryFrontmatterWriteBack?.UUID ?? DEFAULT_SETTINGS.default?.foundryFrontmatterWriteBack?.UUID,
							}
						};
				}
				debug.log("Migration completed.Migrated to new profile settings: ",newProfileCollection);
				//if after migration there is more than one active profile we will default to the default profile because we do not know which is the desired correct one
				if (activeProfileNameCollection.length !== 1){
					newProfileCollection["default"].isActiveProfile = true;
				} else {
					newProfileCollection[activeProfileNameCollection[0]].isActiveProfile = true;
				}
				return newProfileCollection;
	}

	/**
	 * save current settings
	 */
	private save = debounce(
		async () => {
			await this.plugin.saveData(this._allProfileData);
		},
		250,
		true
	);
}

//Rules Modal - Modal for editing the rules
export class RuleEditorModal extends Modal {
	private _rulesData: string[][];
	private onSave?: (newRulesData: string[][]) => void;
	private _inputInfo: string; // Information about the input field for the user
	private _dropdown: string[]; // Dropdown for selecting the rules types
	constructor(
		app: App,
		rulesData: string[][],
		onSave?: (newRulesData: string[][]) => void,
		inputInfo?: string,
		dropdown?: string[]
	) {
		super(app);
		this._rulesData = rulesData;
		this.onSave = onSave;
		this._inputInfo = inputInfo ?? "";
		this._dropdown = dropdown ?? ["empty"]; // Default dropdown values if none are provided
	}
	get rulesData(): string[][] {
		return this._rulesData;
	}

	display() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.style.overflowY = "auto"; // Enable vertical scrolling
		contentEl.style.overflowX = "auto"; // Enable horizontal scrolling
		const container = contentEl.createDiv();
		container.createEl("h2").setText("Replacement rules");
		const inputHelp = container.createDiv();
		inputHelp.createSpan().setText(this._inputInfo);
		const inputNewRule = new Setting(container);
		inputNewRule.addText(text => {
			text.inputEl.style.width = "100%";
			text.setPlaceholder("Enter new rule to add ...");
			text.setValue("");
			text.inputEl.setAttribute("id", `newRule`);
			text.inputEl.setAttribute("name", `newRule`);
			let fieldValue = "";
			//Seems I need to save the value on change else I get empty rules and  things go haywire
			//FIXME: Check if that really is necessary
			text.inputEl.addEventListener("change", () => {
				fieldValue = text.inputEl.value;
			});
			text.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					this.rulesData.push([text.inputEl.value, ""]);
					this.onSave?.(this.rulesData); //New MONDAY callback to save the rulesData
					this.display();
					const newInputEl = document.getElementById("newRule") as HTMLInputElement;
					if (newInputEl) {
						newInputEl.focus();
					}
				}
			});
		});

		// Add key-value pairs
		this.rulesData.forEach((rule, index, array) => {
			const SingleElement = new Setting(container);
			// Remove the div element which contains the label and creates the first column
			const labelEl = SingleElement.settingEl.querySelector(".setting-item-info");
			if (labelEl) {
				labelEl.remove();
			}
			SingleElement.addExtraButton(button => {
				button.setIcon("trash-2");
				button.extraSettingsEl.setAttribute("id", `${index}`);
				button.extraSettingsEl.setAttribute("name", `ButtonDelete`);
				const ButtonNumber = index + 1; // Add 1 to index for better readability
				//FIXME: Change all references to buuton/ID index instead for all elements
				button.onClick(() => {
					const indexNumber: number = +button.extraSettingsEl.id;
					// Get the index from the button's ID, this is a constant which is saved for this element in the code?
					// Remove the rule from the rulesData array
					this.rulesData.splice(indexNumber, 1);
					this.onSave?.(this.rulesData); //New MONDAY callback to save the rulesData
					this.display();
				});
			});

			SingleElement.addText(text => {
				// Set the width of the input field (e.g., 300px)
				text.inputEl.style.width = "80%";
				// Optionally, set the font size (e.g., 18px)
				//text.inputEl.style.fontSize = "18px";
				//text.inputEl.style.fontFamily = "monospace";
				text.setPlaceholder("Enter rule...");
				text.setValue(rule[0]);
				text.inputEl.setAttribute("id", `${index}`);
				text.inputEl.setAttribute("name", `itemRowA-${index}`);
				text.inputEl.addEventListener("change", () => {
					const currentRuleValue = rule[0]; // Get the  rule value
					const indexNumber: number = +text.inputEl.id;
					// Check if the currentRuleValue is not empty
					if (text.inputEl.value === "") {
						// If the currentRuleValue is empty, remove the rule from the rulesData array
						this.rulesData.splice(indexNumber, 1);
						this.display();
					} else if (currentRuleValue) {
						// If the currentRuleValue is not empty, update the value in the rulesData array
						// Update the value in the array
						this.rulesData[indexNumber][0] = text.inputEl.value;
					}
					if (this.onSave) {
						//It should make sense here because it is called when the user changes the rule
						this.onSave(this._rulesData);
					}
				});
				text.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
					if (e.key === "Enter") {
						//TODO: check if code usefull or better remove it
						//console.log("==> Enter first rule");
					}
				});
			});

			SingleElement.addText(text => {
				text.inputEl.style.width = "80%";
				text.setPlaceholder("Enter replacement...");
				text.setValue(rule[1]);
				text.inputEl.setAttribute("id", `${index}`);
				text.inputEl.setAttribute("name", `itemRowB-${index}`);
				text.inputEl.addEventListener("change", () => {
					const indexNumber: number = +text.inputEl.id;
					// Update the value in the mapData
					this.rulesData[indexNumber][1] = text.inputEl.value;
				});

				text.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
					if (e.key === "Enter") {
						//TODO: check if code usefull or better remove it
						//console.log("==> Enter in second rule field");
					}
				});
			});

			if (this._dropdown[0] !== "empty") {
				// Add a dropdown if _dropdown is provided and has values

				SingleElement.addDropdown(dropdown => {
					dropdown.selectEl.setAttribute("dropdown", `${index}`); // Set the ID of the dropdown to be unique
					let dropdownList: string[] = this._dropdown; // Use the dropdown values passed to the constructor to construct the dropdown list;
					for (let i = 0; i < dropdownList.length; i++) {
						dropdown.addOption(dropdownList[i], dropdownList[i]);
					}
					dropdown.setValue(this._dropdown[0]); // Set the first dropdown value as default
				}); //End of dropdown
			} // End of dropdown check

			// Add the plus button
			SingleElement.addExtraButton(button => {
				button.setIcon("circle-arrow-up");
				button.extraSettingsEl.setAttribute("id", `${index}`);
				button.extraSettingsEl.setAttribute("name", `ButtonUp`);
				button.onClick(() => {
					const indexNumber: number = +button.extraSettingsEl.id;
					//exchange the order of the rules
					if (indexNumber > 0) {
						const temp = this.rulesData[indexNumber];
						this.rulesData[indexNumber] = this.rulesData[indexNumber - 1];
						this.rulesData[indexNumber - 1] = temp;
						this.display();
					}
				});
			});
			SingleElement.addExtraButton(button => {
				button.setIcon("circle-arrow-down");
				button.extraSettingsEl.setAttribute("id", `${index}`);
				button.extraSettingsEl.setAttribute("name", `ButtonDown`);

				button.onClick(() => {
					const indexNumber: number = +button.extraSettingsEl.id;
					//exchange the order of the rules
					if (indexNumber < this.rulesData.length - 1) {
						const temp = this.rulesData[indexNumber];
						this.rulesData[indexNumber] = this.rulesData[indexNumber + 1];
						this.rulesData[indexNumber + 1] = temp;
						this.display();
					}
				});
			});
		});
	}

	onOpen() {
		this.modalEl.style.width = "50vw"; // Set width to 50% of the viewport
		this.display();
	}

	onClose() {
		if (this.onSave) {
			this.onSave?.(this.rulesData); // Pass the updated rules data to the callback
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class jsCodeModal extends Modal {
	private jsCode: string = "";
	private onSubmit: (result: string) => void;
	private _settings: MarkdownToFoundrySettings;


	constructor(app: App, settings: MarkdownToFoundrySettings, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this._settings = settings;

	}
	onOpen() {
		const { contentEl } = this;
		contentEl.style.overflowY = "auto"; // Enable vertical scrolling
		contentEl.createEl("h2", { text: "Enter your javascript function. The HTML is available as 'html' variable. Return the HTML with a return statement. The 'api' object holds additional methods." });
		// First text area
		new Setting(contentEl).addTextArea(textarea => {
			textarea.inputEl.rows = 30;
			textarea.inputEl.cols = 60;
			textarea.inputEl.style.width = "100%";
			textarea.setValue(this._settings.jsCode);
			textarea.onChange(value => {
				this.jsCode = value;
			});
		});

		// Submit button
		new Setting(contentEl).addButton(btn =>
			btn
				.setButtonText("Submit")
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.jsCode);
				})
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class FooterHeaderModal extends Modal {
	private _header: string = "";
	private _footer: string = "";
	private onSubmit: (result: [string, string]) => void;

	constructor(app: App, header: string, footer: string, onSubmit: (result: [string, string]) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this._header = header;
		this._footer = footer;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Enter your inputs which will be added to your export HTML" });
		// First text area
		new Setting(contentEl).setName("Header information ").addTextArea(textarea => {
			textarea.inputEl.rows = 12;
			textarea.inputEl.cols = 40;
			textarea.setValue(this._header);//(this._settings.footerAndHeader[0]);
			textarea.onChange(value => {
				this._header = value;
			});
		});

		// Second text area

		new Setting(contentEl).setName("Footer information").addTextArea(textarea => {
			textarea.inputEl.rows = 12;
			textarea.inputEl.cols = 40;
			textarea.setValue(this._footer)//(this._settings.footerAndHeader[1]);
			textarea.onChange(value => {
				this._footer = value;
			});
		});

		// Submit button
		new Setting(contentEl).addButton(btn =>
			btn
				.setButtonText("Submit")
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit([this._header, this._footer]);
				})
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class FoundrySelectIdModal extends Modal {
	private clients: any[];
	private onSubmit: (selectedId: string | null) => void;
	private choosenClientId: string | null;

	constructor(app: App, clientList: any[], onSubmit: (selectedId: string | null) => void) {
		super(app);
		this.clients = clientList;
		this.onSubmit = onSubmit;
		this.choosenClientId = clientList.length > 0 ? clientList[0]?.id : null;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty(); // clear the modal content
		contentEl.createEl("h2", { text: `${this.clients.length} Foundry instance${this.clients.length !== 1 ? 's' : ''} found - select an instance` });

		// Create a wrapper div to set css for flex layout
		const wrapper = contentEl.createDiv({ cls: "foundry-select-wrapper" });
		wrapper.setCssStyles({ display: 'flex', gap: '20px' });

		// Dropdown
		// LEFT: Dropdown in wrapper div
		const selectEl = wrapper.createEl("select", { cls: "foundry-select-dropdown" });
		this.clients.forEach(item => {
			const option = selectEl.createEl("option", { text: item?.customName || item?.worldTitle, value: item?.id }); //create an option tag for each client found
			if (item?.id === this.choosenClientId) option.selected = true; // sets the option tag to true and thus to active
		});

		// RIGHT: Details pane in wrapper div
		const detailsPane = wrapper.createDiv({ cls: "foundry-details-pane" });
		detailsPane.setCssStyles({
			flex: '1',
			border: '1px solid var(--text-normal)',
			padding: '10px',
			overflowY: 'auto'
		});

		// Helper to update details pane
		const updateDetails = (clientId: string) => {
			detailsPane.empty(); // clear the pane after a selection
			const selectedClient = this.clients.find(c => c.id === clientId); //find the client object with the selected client id
			if (!selectedClient) {
				detailsPane.createEl("p", { text: "No details available" });
				return;
			}
			// Show each property in the selected client object
			Object.entries(selectedClient).forEach(([key, value]) => {
				detailsPane.createEl("p", { text: `${key}: ${value}` });
			});
		};

		// Initial details display for initial selection
		if (this.choosenClientId) {
			const initialId = this.choosenClientId
			updateDetails(initialId);
		}


		selectEl.onchange = (e: Event) => {
			const returnFoundryID = (e.target as HTMLSelectElement).value // reads the selected options tag value
			updateDetails(returnFoundryID);
			this.choosenClientId = returnFoundryID ?? "";
		};

		// OK and Cancel buttons
		new Setting(contentEl)
			.addButton(btn =>
				btn
					.setButtonText("OK")
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(this.choosenClientId); //return the choosen clientID
					})
			)
			.addButton(btn =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
					this.onSubmit(null);
				})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
