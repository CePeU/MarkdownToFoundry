import {
	addIcon,
	debounce,
	Editor,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	setIcon,
	TFile,
	normalizePath,
	FileSystemAdapter,
} from "obsidian";

import {App} from "obsidian";
import { TwoColumnListModal, RowArray } from "./modals";

import { cleanHtml, replacePictureLinks,replaceHrefPaths } from "./html-cleaner";
import { Foundry, FoundryHtml, generateIdForFile } from "./foundry";
import {VERSION_CONSTANTS } from "./versionConstant";
import { showBrowserNotification, ObsidianPicture,debug,createRelativePath, buildPictureUploadList } from "./utils";
import { writeToFilesystem, writeToFilesystem_Pictures } from "./utils-file"
import { MarkdownToFoundrySettings, MarkdownToFoundrySettingsTab as MarkdownToFoundrySettingsTab } from "./settings";

export const MARKDOWN_TO_FOUNDRY_ICON = 
`
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-markdownttofundry">
  <path d="M 10 2 L 13.5 2" />
  <path d="M 10 9 L 10 2" />
  <path d="M 10.89 16 L 10.89 22" />
  <path d="M 13.5 5.5 L 10 5.5" />
  <path d="M 15 18 L 17.5 16" />
  <path d="M 17.5 16 L 20 18" />
  <path d="M 17.5 2.5 L 20.5 5.5" />
  <path d="M 17.5 22 L 17.5 16" />
  <path d="M 2.5 5.5 L 5.5 8.5" />
  <path d="M 20.5 5.5 L 17.5 8.5" />
  <path d="M 3.5 16 L 7.24 19" />
  <path d="M 3.5 22 L 3.5 16" />
  <path d="M 5.5 2.5 L 2.5 5.5" />
  <path d="M 7.24 19 L 10.89 16" />
  <path d="M2 12.5h20" />
</svg>
`

export default class MarkdownToFoundry extends Plugin {
	private copyInProgressModal: Modal;
	private copyResult: HTMLElement | undefined;
	private activeFile: TFile;
	public debugMode: boolean = false;
	private platform: string;

	async onload() {
		debug.setDebugMode(false); //default is true
		// add custom icon
		this.platform = process.platform ?? "";

		this.addCommand({
      id: "open-two-column-list-modal",
      name: "Open two-column list modal",
      callback: () => {
        this.openTwoColumnModal();
      }
    });

this.registerMarkdownPostProcessor((el, ctx) => {
            // Alle Callouts vom Typ "foundry-secret" finden
            const secretCallouts = el.querySelectorAll<HTMLDivElement>('.callout[data-callout="foundry-secret"]');
console.log("Secret main container: ",secretCallouts)

            secretCallouts.forEach(callout => {
                // In Obsidian ist der Inhalt typischerweise in .callout-content
                const contentEl = callout.querySelector(".callout-content") as HTMLElement | null;
				console.log("Content Element: ",contentEl)
				const contentElTitle = callout.querySelector(".callout-title") as HTMLElement | null;
				console.log("Content Element Title: ",contentElTitle)
                // Fallback: Wenn keine spezielle Content-Region gefunden wird, nimm den gesamten Callout-Inhalt
                const contentHTML = contentEl ? contentEl.innerHTML : callout.innerHTML;

                // Zufällige ID erzeugen (z. B. "secret-<timestamp>-<random>")
                const randomId = `secret-${Foundry.generateFoundryID(this.app)}`;

                // Neues <section>-Element erstellen
                const section = document.createElement("section");
                section.classList.add("M2F");
				section.classList.add("secret");
                section.id = randomId;

                // Inhalt des Callouts in das section-Element übernehmen
                // (nur der Text/Content, ohne Callout-Rahmen)
                section.innerHTML = contentHTML;

                // Callout im DOM durch das neue <section>-Element ersetzen
                callout.parentElement?.replaceChild(section, callout);
            });
        });

		addIcon(
			"markdownToFoundry-icon", MARKDOWN_TO_FOUNDRY_ICON
		);

		// init settings
		const settingsTab = new MarkdownToFoundrySettingsTab(this.app, this); //the settings Object which becomes the settings modal is created here
		this.addSettingTab(settingsTab); //the settingsTab is added here to the plugin to become the settings window
	

		// init modal
		this.copyInProgressModal = new Modal(this.app); // create modal as object and storing it in the property/class
		this.copyInProgressModal.titleEl.setText("Creating HTML from Markdown"); // extend the modal and set the title
		const rotateDiv = createDiv({ parent: this.copyInProgressModal.contentEl, cls: "mdToFoundry-rotate" }); // create a div with the modal content
		setIcon(rotateDiv, "loader");

		
		const copyCallbackRibbon = this.copyCallbackModified(settingsTab);
		const copyCallbackSubmenu = this.copyCallbackPlain(settingsTab);
		// add the ribbon icon
		this.addRibbonIcon(			
			"markdownToFoundry-icon",
			"Copy editor selection or full note as HTML or upload to Foundry",
			() => copyCallbackRibbon()
		);

		// Add import profile command
        this.addCommand({
            id: "import-profile-json",
            name: "Import profile from JSON file",
            callback: () => this.importProfileFromJSON(settingsTab),
        });


		// Generate a command which can be called by templater to insert a foundry ID which will be unique from all used ID
		this.addCommand({
			id: 'createfoundryId',
			name: 'generate foundry ID',
			callback: () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

				if (activeView && activeView.editor) {
					const editor = activeView.editor;
					const cursor = editor.getCursor();
					const id = Foundry.generateFoundryID(this.app)
					editor.replaceSelection(id);
					editor.setCursor({
						line: cursor.line,
						ch: cursor.ch + 16 // Move cursor after generating the ID
					});
				}
			}
		});

		// Generate a command to be able to call the export with the currently active profile
		this.addCommand({
			id: "clipboard",
			icon: "markdownToFoundry-icon",
			name: "Copy editor selection or full note as HTML or upload to Foundry",
			callback: copyCallbackRibbon,
		});
		
		//Add a menu entry in the pop up file menu and get the selected file or files of the selected directory and subdirectories
		/*TODO: implement if batch is possible - DISABLED FOR NOW: 
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				menu.addItem(item => {
					item
						.setTitle(`==NOT Implemented yet== HTML batch export of FOLDERTREE`)
						.setIcon("markdownToFoundry-icon")
						.onClick(() => {
							const folder = file.path;
							//getMarkdownFiles returns an array of objects of ALL markdown files in the obsidian vault
							const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(folder + "/"));
							for (let i = 0; i < files.length; i++) {
								console.log("The files are", files);
								//Function call what to do with the Files
							}
						});
				});
			})
		);
		*/

		//Add editor right button menue and submenu items. Submenues might not be officially supported
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, file) => {
				menu.addItem(item => {
					item.setTitle("Foundry HTML export");
					item.setIcon("markdownToFoundry-icon");
					const profileList: string[] = Object.keys(settingsTab.allProfileData).sort();
					for (let i = 0; i < profileList.length; i++) {
						const profileName = profileList[i];
						// @ts-ignore
						const subitem = item.setSubmenu();
						// @ts-ignore
						subitem.addItem(profileItem => {
							profileItem.setTitle(profileName);
							profileItem.onClick(() => {
								settingsTab.activateProfile = profileName;
								copyCallbackSubmenu();
							});
						});
					}
				});
			})
		);

		// register post processor to monitor markdown render progress
		this.registerMarkdownPostProcessor(async (el, ctx) => {
			// INFO:
			// We can't unregister the post processor, and all postprocessors are called every time a render is triggered.
			// To test if the render was triggered by our copy process, we check if our copy process is in progress.
			//cepeu: By calling MarkdownRenderer.render in the renderHtml method, we trigger the post processor method to be called.
			//cepeu: The post processor is called during the markdown rendering when a code block is processed by a registered post processor
			//cepeu: I assume that for every section of the markdown this post processor method is called. The post processor now can
			//cepeu: modify the render result by querying the el => html node element.
			//cepeu: the post processors are finished if this.copyResult has a value different from undefined
			//cepeu: this.copyResult is set at the end of the (whole) Markdown render process
			//cepeu: this.hasCopyReseult holds the rendered HTML in the copyResult property
			//cepeu: sadly dataview is not rendering the markdown content in the post processor, at this point yet but it seems to take place later
			//cepeu: in the view mode of the editor

			if (this.hasCopyResult()) {
				// Get's called after every segment (can be multiple for renders with plugins like dataview).
				// Since it has a debounce delay that will reset after every call,
				// this function will execute effectively only once after all rendering actions are fully done

				//TODO: Investigae if Clippboard or file export should be done here
				this.exportHtml(settingsTab.activeProfileData);
			}
		}, Number.MAX_SAFE_INTEGER);
	}

	/** Openes a modal to let the user know that the copy is in progress and triggers the render of the markdown document or selection. */
	// The renderHtml method is called to render the markdown content to HTML and store it in the copyResult div
	private renderHtml = async (editor: Editor, settings?: MarkdownToFoundrySettings, fileListToRender?: string[]) => {
		
		debug.log("Entered the render function");
		
		// path is needed to resolve relative links in the markdown content

		//lets us grab the active file object the render is based on so we can use it later on during html processing
		if (this.app.workspace.activeEditor?.file) {
			this.activeFile = this.app.workspace.activeEditor?.file;
		}

		const path = this.activeFile.path ?? ""; //we need the path as an input for the Markdown renderer
		const content = () => {
			if (editor.somethingSelected()) {
				return editor.getSelection(); // if the editor has a selection, we return the selected text
			} else {
				return editor.getValue(); // if the editor has no selection, we return the whole content of the editor
			}
		};
		
		debug.log("MarkdownTo: Copying to clipboard", path);
		
		// The result of the render is stored in copyResult by appending the rendered html elements one by one
		// so the render result is stored on the property the render process can be called several times
		await MarkdownRenderer.render(this.app, content(), this.copyResult as HTMLElement, path, this); // render the markdown content to HTML and store it in the copyResult div

		/*
static render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void>;

MarkdownRenderer.render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void>;
Parameter	Type		Description
app			App			Reference to the current Obsidian app instance.
markdown	string		The Markdown source code to be rendered.
el			HTMLElement	The HTML element where the rendered Markdown will be appended.
sourcePath	string		The normalized path of the Markdown file, used for resolving relative internal links.
component	Component	The parent component to manage the lifecycle of the rendered child components (usually this).

*/
	};

	/** Creates the cleaned html from the rendered HTML and exports it to the clipboard, disk or foundry. */
	private exportHtml = debounce(
		async (settings: MarkdownToFoundrySettings) => {
			
			debug.log("Rendered HTML is processed for output")
			
			const file = this.activeFile; //get the file object of the active file for batch report it might need to be filled by the collected files
			const NodeHtml: HTMLElement = this.copyResult as HTMLElement; //maybe necessary for batch export
			let obsidianPictureList: ObsidianPicture[] = [];
			let foundryHtml: FoundryHtml = {
				html: "",
				foundryLinks: [],
				obsidianFileObj: this.activeFile,
				obsidianUUID: "",
				obsidianRelPath:"",
			};
			let cleanedHTML = "";
			let dirtyHTML = ""
			let foundryPicturePath = "assets/pictures";
			if (file) {
			if (settings.htmlExportFilePath || settings.exportFoundry){
				try {
			
			//build the picture list to be uploaded and the paths to which directory they are uploaded
			// TODO: for batch ObsidianPictureCollection should probably become a set which collects all picture collections of the page instances

							if (settings.foundrySettingsUsed) {
							// 'file' is a TFile object representing the note
							foundryPicturePath = settings.foundryPicturePath ?? "assets/pictures"
							if (settings.foundryFrontmatterWriteBack.isWriteBack) {
								await this.app.fileManager.processFrontMatter(file, frontmatter => {
									foundryPicturePath =
										frontmatter["VTT_PicturePath"] ?? settings.foundryPicturePath ?? "assets/pictures";
								});
							}
						}

			debug.log("Picture list build starts")
			obsidianPictureList = await buildPictureUploadList(
				NodeHtml,
				this.app,
				file,
				foundryPicturePath
			); //build the picture list to be uploaded and the paths to which directory they are uploaded
				} catch (error) {
						// Extract a safe error message
						let message = "Unknown error";
						if (error instanceof Error) {
							message = error.message;
						} else {
							message = String(error);
						}
						// Show a notice in Obsidian with the error message
						new Notice(`Error: ${message}`, 5000); // 5000 ms = 5 seconds duration
						showBrowserNotification("Error: ", { body: message }); //TODO: decide if both messages make sense or just use one and which one of the should stay then
					}}}

			// =======(FOUNDRY) Export INIT ================================================================================================
			if (settings.exportFoundry && settings.exportDirty === false) {
				if (settings.foundryApiKey && settings.foundryRelayServer){
				debug.log("Foundry export has started")
				
				//file might needed to be changed or read from an array because so far it is the file of the active editor!!!
				if (file) {
					try {
						await Foundry.init(this.app, settings); //init the static part of the Foundry class needs to be MOVED for batch BEFORE batch starts

						//TODO: a loop to work trough all batch files (an array of files) and build the picture list
						//TODO: Make this generic so a picture list is also build for file export, also generate a copy of the original to consume later on
						//TODO: Analyse if you need two picture lists, one for link replacement and a global one for uploading files which is reduced to uploaded pictures
						// probably a "set" is the way to go for the pure upload but array information needs to be probably reduced for that 

						//TOOD: Put this into the init function of the Foundry class 
						// and/or move it also into the instance of a foundry page object for batch file because frontmatter might change for each page instance
						
						debug.log("Foundry Init was started")
						/*
						if (Foundry.settings.foundrySettingsUsed) {
							// 'file' is a TFile object representing the note
							picturePath = Foundry.settings.foundryPicturePath || "assets/pictures"
							if (Foundry.settings.foundryFrontmatterWriteBack.isWriteBack) {
								await Foundry.app.fileManager.processFrontMatter(file, frontmatter => {
									picturePath =
										frontmatter["VTT_PicturePath"] || Foundry.settings.foundryPicturePath || "assets/pictures";
								});
							}
						}*/
						//build the picture list to be uploaded and the paths to which directory they are uploaded
						// TODO: for batch ObsidianPictureCollection should probably become a set which collects all picture collections of the page instances
						//console.log("==Picture List build starts")
						//obsidianPictureList = await Foundry.buildPictureUploadList(
					//		NodeHtml,
					//		this.app,
					//		this.activeFile,
					//		picturePath
					//	); //build the picture list to be uploaded and the paths to which directory they are uploaded
						Foundry.ObsidianPictureCollection = obsidianPictureList; //Maybe not necessary anymore need to make function of building picture obsidian and not foundry specific
						
					} catch (error) {
						// Extract a safe error message
						let message = "Unknown error";
						if (error instanceof Error) {
							message = error.message;
						} else {
							message = String(error);
						}
						// Show a notice in Obsidian with the error message
						new Notice(`Error: ${message}`, 5000); // 5000 ms = 5 seconds duration
						showBrowserNotification("Error: ", { body: message }); //TODO: decide if both messages make sense or just use one and which one of the should stay then
					}
				} else {
					new Notice(`Error: The specified Obsidian file could not be found`, 5000); // 5000 ms = 5 seconds duration
					showBrowserNotification("Error: ", { body: "The specified Obsidian file could not be found" });
				}
			}}
			//FOUNDRY EXPORT INIT END ================================================================================================================================

			//Clippboard EXPORT AND HTML cleaning ========================================================================

			if (settings.exportDirty) {
				if (settings.isDebugOutput) {
					debug.log("Exporting dirty HTML to clipboard");
				}
				// if the user wants to export the dirty HTML, we just copy the result of the render
				dirtyHTML = this.copyResult?.innerHTML ?? "";
				if (settings.exportClipboard) {
					navigator.clipboard
						.writeText(dirtyHTML ?? "")
						.then(() => new Notice("Dirty HTML copied to the clipboard", 3500))
						.catch(() => new Notice("Couldn't copy HTML to the clipboard", 3500))
						.finally(() => this.endCopyProcess());
				} else { this.endCopyProcess(); } // if the user does not want to export to clipboard, we just end the copy process
			} else {
				
				debug.log("Exporting cleaned HTML to clipboard");
				
				// if the user wants to export the clean HTML, we need to render and wait for the render to finish
				this.copyInProgressModal.close();

				foundryHtml = await cleanHtml(this.copyResult as HTMLElement, settings, this.activeFile);
				
				cleanedHTML = foundryHtml.html; // get the cleaned html from the tempHtml object
				let clipboardHTML = settings.footerAndHeader.clipboard[0] + cleanedHTML + settings.footerAndHeader.clipboard[1];
				//html = settings.footerAndHeader[0] + html + settings.footerAndHeader[1]; //let us add additional html informations again at the end of rendering AND cleaning if desired
				if (settings.exportClipboard) {
					navigator.clipboard
						.writeText(clipboardHTML)
						.then(() => new Notice("Cleaned HTML copied to the clipboard", 3500))
						.catch(() => new Notice("Couldn't copy html to the clipboard", 3500))
						.finally(() => this.endCopyProcess());
				} else { this.endCopyProcess(); } // if the user does not want to export to clipboard, we just end the copy process
			}

			//Clippboard EXPORT and HTML cleaning END ====================================================================

			// =======FOUNDRY Export PAGES ================================================================================================
			if (settings.exportFoundry && settings.exportDirty === false) {
				if (settings.foundryApiKey && settings.foundryRelayServer){
				if (Foundry.clientId !== ""){
				
				debug.log("Exporting HTML to Foundry");
				
				//file might needed to be changed or read from an array because so far it is file of the active editor!!!
				if (foundryHtml.obsidianFileObj) {
					try {
						// adjust file paths to Foundry standards in html
						if (settings.ObsidianWriteFrontmatter) {
							foundryHtml.obsidianUUID = generateIdForFile(this.app, foundryHtml.obsidianFileObj); //generate a new UUID for the current note/html if not already set in the frontmatter this allows to link notes and links
						} else {foundryHtml.obsidianUUID = ""}
						if (foundryHtml.foundryLinks.length > 0) {
							// if there are Foundry links, we need to set the obsidianUUID which is the source into each link information
							for (const link of foundryHtml.foundryLinks) {
								link.obsidianNoteUUID = foundryHtml.obsidianUUID; // set the obsidian UUID for each link
							}
						}

						//replace picture links in html
						//let content = settings.footerAndHeader.foundryHTML[0] + foundryHtml.html + settings.footerAndHeader.foundryHTML[1];
						let content = replacePictureLinks(foundryHtml.html, settings, obsidianPictureList);
						foundryHtml.html = settings.footerAndHeader.foundryHTML[0] + content + settings.footerAndHeader.foundryHTML[1]; // set the picture link adjusted html to the foundryHtml object

						// time to create a page object for the foundry API which holds the html and all necessary information for post processing
						// the html and to upload the page to foundry
						
						const foundryPage = await Foundry.initFoundryPageObject(this.app, foundryHtml);
						
						//TODO: For batch export the pages objects need to be traversed and clustered according to the journals they are in
						//then they need to be build to one big page update object while also making sure create and update pages are correct
						//then one final update operation for each journal needs to take place
						await foundryPage.createOrUpdatePage();
				
						await Foundry.apiPost_ListOfFiles(); //uploads pictures and needs to be the last after all pages and html have been created
						//await Foundry.fetchFileList() //maybe put this only as last after a potential batch export

						//close a headless session after the update if one has been opened
						if (settings.foundryHeadlessUsed) {
							await Foundry.apiDelete_endHeadlessSession(Foundry.foundryRelayServer, Foundry.foundryApiKey, Foundry.sessionId)
						}
					} catch (error) {
						// Extract a safe error message
						let message = "Unknown error";
						if (error instanceof Error) {
							
							debug.log("Error Object Output:", error)
							
							message = error.message;
							//message = String(error)
						} else {
							message = String(error);
						}
						// Show a notice in Obsidian with the error message
						
						debug.log("Error Object Output:", error)
						
						new Notice(`Error: ${message}`, 5000); // 5000 ms = 5 seconds duration
						showBrowserNotification("Error: ", { body: message });
					}
				} else {
					new Notice(`Error: The specified Obsidian file could not be found`, 5000); // 5000 ms = 5 seconds duration
					showBrowserNotification("Error: ", { body: "The specified Obsidian file could not be found" });
				}
			}}}
			//FOUNDRY EXPORT PAGES END ================================================================================================================================

			// FILE EXPORT START ======================================================================================================================
			// Start HTML export if file export is selected
			if (settings.exportFile) {
				
				debug.log("Export to the file system takes place - with the picture list of:",obsidianPictureList);
				// Content to save
				let exportContent=""
				if (settings.exportDirty) {
					exportContent = dirtyHTML //foundryHtml.html; //write html which has no foundry replacements or html which is just cleaned html!!
				} else {
					
					exportContent = settings.footerAndHeader.fileHTML[0] + cleanedHTML + settings.footerAndHeader.fileHTML[1];
					
				}
				//Get the vault path which is the root directory of the Obsidian vault
				let vaultPath = "";
				const adapter = this.app.vault.adapter;
				if (adapter instanceof FileSystemAdapter) {
					vaultPath = adapter.getBasePath(); // TODO: Check if vaultPath is ever used
				}
				let fileName = this.activeFile?.basename ?? ""; //this returns the file name without the extension
				const htmlFileName = fileName + ".html"; // append the .html extension to the file name


				//returns the platform the plugin is running on - can be linux,darwin,win32
				//const platform = process.platform;
				// TODO: Check for other platforms and export to them - needs to build the file paths correctly
				const Schalter: boolean = true; // TODO: this is a switch to check if the file should be written to the vault or to a specific path on Windows - for now hardcoded to only go to a path outside of the vault
				// the idea is to export to a vault path and create it if file export is set to true
				if (this.platform === "win32" || this.platform === "linux" || this.platform === "darwin" && Schalter) {
					// Windows specific code}
					let isVaultStructure = false
					if (settings.htmlExportFilePath !== "") {
						let exportFilePath = settings.htmlExportFilePath
						if(settings.isExportVaultPaths){
							isVaultStructure = true;
							exportFilePath = normalizePath(settings.htmlExportFilePath +"/"+ createRelativePath(foundryHtml.obsidianFileObj))
							//settings.htmlExportFilePath = exportFilePath
							debug.log("HMTL file export path: ",exportFilePath)
						}




						try {
						//&& obsidianPictureList.length>0
						if (!settings.exportDirty){
							if(settings.htmlLinkPath){
								exportContent = replaceHrefPaths(settings.htmlLinkPath,exportContent,foundryHtml.foundryLinks,this.platform,isVaultStructure)
							} else {
								exportContent = replaceHrefPaths(settings.htmlExportFilePath,exportContent,foundryHtml.foundryLinks,this.platform,isVaultStructure)
							}
							const writePictureResult = await writeToFilesystem_Pictures(exportFilePath,obsidianPictureList,exportContent,settings) //TODO: decide if settings or activeprofiledata is better here						
						exportContent = writePictureResult
						}
						/*
						if (writePictureResult.success) {
							new Notice("HTML file exported successfully to the filesystem", 3500)
							debug.log(`File was written successfully ${settings.htmlExportFilePath}${htmlFileName}`)
							}else {
							debug.log("Error:", writePictureResult.error);	
						}
						*/

						} catch (error) {
							new Notice("Error creating HTML file: " + error, 3500);
        					debug.log('Unexpected error:', error);
    					}

						try {
						const writeResult = await writeToFilesystem(exportFilePath, htmlFileName, exportContent) //TODO: decide if settings or activeprofiledata is better here
						
						if (writeResult.success) {
							new Notice("HTML file exported successfully to the filesystem", 3500)
							debug.log(`File was written successfully to path = ${exportFilePath} with filename = ${htmlFileName}`)
							}else {
							debug.log("Error:", writeResult.error);	
						}

						} catch (error) {
							new Notice("Error creating HTML file: " + error, 3500);
        					debug.log('Unexpected error:', error);
    					}

				}} else {
					// File path within the vault
					const filePath = normalizePath(fileName);
					// Check if file exists
					//const existingFile = this.app.vault.getAbstractFileByPath(filePath);
					//getAbstractFileByPath was removed in Obsidian v1.8.10
					//Instead use getFileByPath andgetFolderByPath`
					const existingFile = this.app.vault.getFileByPath(filePath);

					if (existingFile instanceof TFile) {
						// If file exists, modify it
						await this.app.vault.modify(existingFile, exportContent);
					} else {
						// If file doesn't exist, create it
						await this.app.vault.create(filePath, exportContent);
					}
				}
			}
			// FILE EXPORT END======================================================================================================================
		},
		500 /* wait delay until copy to clipboard happens */,
		true /* reset delay if method is called before timer finishes */
	);

	private startCopyProcess(settings?: MarkdownToFoundrySettings) {
		
		debug.log("Copy Process has started");
		
		this.copyResult = createDiv();
		this.copyInProgressModal.open();
	}

	private endCopyProcess(settings?: MarkdownToFoundrySettings) {
		
		debug.log("Copy Process has stopped");
		
		this.copyResult = undefined;
		this.copyInProgressModal.close();
	}

	private hasCopyResult() {
		return this.copyResult !== undefined;
	}

	/** Reads the VTTprofile from frontmatter and sets it as active profile if it exists */
    private async getProfileFromFrontmatter(file: TFile): Promise<string | null> {
        try {
            let profileName: string | null = null;
            await this.app.fileManager.processFrontMatter(file, frontmatter => {
                profileName = frontmatter["VTTprofile"] ?? null;
            });
            return profileName;
        } catch (error) {
            debug.log("Error reading VTTprofile from frontmatter:", error);
            return null;
        }
    }

	private copyCallbackPlain(settingsTab: MarkdownToFoundrySettingsTab) {
			return async () => {
			debug.log("Started with the copy and render process of the HTML");
			
			//Important!
			//await forceRerender(this.app,this)
			const view = this.app.workspace.getActiveViewOfType(MarkdownView); // get the active view of the workspace, which is a markdown view
			if (view != null) {
				// if the view is not null, we have an active markdown view
				if (view.editor != null) {
					// if the editor is not null, we have an active markdown editor
					this.startCopyProcess(settingsTab.activeProfileData); // start the copy process by creating a new div to store the rendered HTML
					this.renderHtml(view.editor); // render the HTML from the editor content
				} else {
					this.copyResult = view.contentEl; // if the editor is null, we have a markdown view without an editor, so we use the content element of the view
					if (this.hasCopyResult()) {
						// if we have a copy result, we can copy the HTML to the clipboard
						this.startCopyProcess(settingsTab.activeProfileData); // start the copy process by creating a new div to store the rendered HTML
						this.exportHtml(settingsTab.activeProfileData); // copy the HTML to the clipboard //settingsTab.settings SETTINGS
					}
				}
			}
			}
		};

    /** Modified copy callback that checks for frontmatter profile */
    private copyCallbackModified(settingsTab: MarkdownToFoundrySettingsTab) {
        return async () => {
            debug.log("Started with the copy and render process of the HTML");
            
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view != null) {
                if (view.editor != null) {
                    this.activeFile = this.app.workspace.activeEditor?.file || this.activeFile;
                    
                    // Check for VTTprofile in frontmatter
                    const frontmatterProfile = await this.getProfileFromFrontmatter(this.activeFile);
                    if (frontmatterProfile && Object.keys(settingsTab.allProfileData).includes(frontmatterProfile)) {
                        settingsTab.activateProfile = frontmatterProfile;
                        debug.log(`Activated profile from frontmatter: ${frontmatterProfile}`);
                    }
                    
                    this.startCopyProcess(settingsTab.activeProfileData);
                    this.renderHtml(view.editor);
                } else {
                    this.copyResult = view.contentEl;
                    if (this.hasCopyResult()) {
                        // Check for VTTprofile in frontmatter
                        const frontmatterProfile = await this.getProfileFromFrontmatter(this.activeFile);
                        if (frontmatterProfile && Object.keys(settingsTab.allProfileData).includes(frontmatterProfile)) {
                            settingsTab.activateProfile = frontmatterProfile;
                            debug.log(`Activated profile from frontmatter: ${frontmatterProfile}`);
                        }
                        
                        this.startCopyProcess(settingsTab.activeProfileData);
                        this.exportHtml(settingsTab.activeProfileData);
                    }
                }
            }
        };
    }

	/** Imports profile data from a JSON file and merges it with the current active profile */
    private async importProfileFromJSON(settingsTab: MarkdownToFoundrySettingsTab): Promise<void> {
        try {
            // Open file picker dialog
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            
            input.onchange = async (event: Event) => {
                const target = event.target as HTMLInputElement;
                const file = target.files?.[0];
                
                if (!file) {
                    debug.log("No file selected");
                    return;
                }

                try {
                    const fileContent = await file.text();
                    const importedData = JSON.parse(fileContent);
                    
                    debug.log("Imported JSON data:", importedData);
                    
                    // Get current active profile settings
                    //const settingsTab = this.app.plugins.plugins['markdown-to-foundry']?.settingsTab as MarkdownToFoundrySettingsTab;
                    if (!settingsTab) {
                        new Notice("Error: Could not access settings", 3500);
                        return;
                    }

                    const currentProfile = settingsTab.activeProfileData;
                    const mergedProfile: MarkdownToFoundrySettings = { ...currentProfile };

                    // Recursively merge imported data with current profile
                    this.mergeProfileData(mergedProfile, importedData);

                    debug.log("Merged profile data:", mergedProfile);

                    // Save merged profile as current active profile
                    settingsTab.allProfileData[settingsTab.activateProfile] = mergedProfile;
					//this._allProfileData
                    await settingsTab.save(); // write save

                    new Notice(`Profile "${settingsTab.activateProfile}" updated with imported data`, 3500);
                    debug.log(`Profile "${settingsTab.activateProfile}" successfully updated`);

                } catch (error) {
                    let message = "Unknown error";
                    if (error instanceof Error) {
                        message = error.message;
                    } else {
                        message = String(error);
                    }
                    new Notice(`Error parsing JSON file: ${message}`, 5000);
                    debug.log("Error parsing JSON:", error);
                }
            };

            input.click();

        } catch (error) {
            let message = "Unknown error";
            if (error instanceof Error) {
                message = error.message;
            } else {
                message = String(error);
            }
            new Notice(`Error opening file dialog: ${message}`, 5000);
            debug.log("Error opening file picker:", error);
        }
    }

    /** Recursively merges imported profile data with existing profile, matching properties */
    private mergeProfileData(target: any, source: any): void {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                if (key in target) {
                    // Property exists in target profile
                    const sourceValue = source[key];
                    const targetValue = target[key];

                    // If both are objects (but not arrays), recursively merge
                    if (
                        sourceValue !== null &&
                        targetValue !== null &&
                        typeof sourceValue === 'object' &&
                        typeof targetValue === 'object' &&
                        !Array.isArray(sourceValue) &&
                        !Array.isArray(targetValue)
                    ) {
                        this.mergeProfileData(targetValue, sourceValue);
                    } else {
                        // For primitives and arrays, directly assign the imported value
                        target[key] = sourceValue;
                        debug.log(`Merged property: ${key} = ${sourceValue}`);
                    }
                } else {
                    debug.log(`Skipped property "${key}" - not found in current profile`);
                }
            }
        }
    }

	

  private openTwoColumnModal() {
    const initial: RowArray = [
      ["A1", "B1"],
      ["A2", "B2"]
    ];

    new TwoColumnListModal(this.app, initial, (result) => {
      if (!result) {
        new Notice("Modal cancelled");
        return;
      }

      // result ist RowArray = [ [string,string], [string,string], ... ]
      console.log("Rows from modal:", result);
      new Notice(`Received ${result.length} rows from modal`);
    }).open();
  }


	onunload() { }
}
