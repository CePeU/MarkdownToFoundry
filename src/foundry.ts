import * as crypto from 'crypto';
//import { Hmac } from "crypto"; probably needed later for automatic login into foundry session
import xxhash, { XXHashAPI } from "xxhash-wasm"; //fast hashing algo for pictures - not sure if note hashing also makes sense
//import * as cheerio from 'cheerio'; //https://www.npmjs.com/package/cheerio
import { MarkdownToFoundrySettings } from "./settings";
//import { MarkdownToFoundry } from "./plugins";
import {
	App,
	requestUrl,
	RequestUrlParam,
	TFile,
	Vault,
	normalizePath,
	FileSystemAdapter,
	Notice,
} from "obsidian";
import { showBrowserNotification, ObsidianPicture,debug } from "./utils";


/**
 * @file foundry.ts
 * @module MarkdownToFoundry
 * 
 * This file provides the core integration logic between Obsidian and Foundry VTT via a REST API relay.
 * It defines the Foundry class and related interfaces for exporting notes, folders, journals, and images
 * from Obsidian to Foundry, supporting both batch and single-note workflows.
 * 
 * ## Key Features:
 * - **Foundry Class:** Central class for managing state, API calls, and data mapping between Obsidian and Foundry.
 * - **Session Management:** Handles headless and standard Foundry sessions, including client and session IDs.
 * - **Folder/Journal/Page Management:** Methods for creating, updating, and mapping folders, journals, and pages in Foundry.
 * - **Frontmatter Handling:** Reads and writes Obsidian frontmatter to synchronize metadata with Foundry.
 * - **Image Uploads:** Manages image file uploads from Obsidian to Foundry, including hashing and path management.
 * - **UUID Mapping:** Maintains and checks UUIDs for notes, journals, and pages to ensure uniqueness and resolve links.
 * - **REST API Integration:** Provides wrappers for Foundry REST API endpoints, including error handling and notifications.
 * - **Macro Creation:** Includes macros for Foundry to resolve Obsidian-style links and automate linking.
 * 
 * ## Usage:
 * - Initialize the Foundry class with Obsidian app and plugin settings.
 * - Use provided methods to export notes, folders, journals, and images to Foundry.
 * - Leverage utility functions for ID generation, existence checks, and batch operations.
 * 
 * ## Dependencies:
 * - Obsidian API (App, TFile, Vault, etc.)
 * - Foundry VTT REST API relay
 * - xxhash-wasm for fast hashing
 * - Node.js crypto for encryption
 * 
 * ## Error Handling:
 * - API errors are logged and shown as notifications in Obsidian and the browser.
 * - Methods return Promises and handle asynchronous operations.
 * 
 * @author MarkdownToFoundry Plugin Authors
 * @version 1.0.0
 */

/*
GET: Retrieves data from the server. It's a read-only operation and doesn't modify any server-side resources.
POST: Creates a new resource on the server.
PUT: Updates an existing resource on the server. It replaces the entire resource with the provided data. If the resource doesn't exist, some APIs might create it.
DELETE: Deletes a resource from the server.
*/


interface FoundryFolder {
	depth: number;
	id: string;
	name: string;
	parent: string;
	type: string;
	path: string;
	sorting: number;
	sortingMode: any;
	folderTree: FoundryFolderTreeNode[];
	fullFolderPath: string; // full path to the folder including all parent folders	
}

interface FoundryFile {
	name: string;
	path: string;
	type: string;
	extension?: string;
}


/**
 * Represents a folder node in the FoundryVTT folder tree.
 */
export interface FoundryFolderTreeNode {
	id: string;
	name: string;
	level: number;
	parentId: string;
	parentName: string;
	parentLevel: number;
	childId: string;
	childName: string;
	childLevel: number;
}

/**
 * Represents a page inside a FoundryVTT journal.
 */
export interface FoundryJournalPage {
	pageId: string;
	pageName: string;
	journalId: string;
	journalName: string;
	folderId: string;
	folderName: string;
	folderTree: FoundryFolderTreeNode[];
	fullFolderPath: string;
	flag: any;
	obsidianUUID: string;
	obsdianLinksRemaining: number;
}

/**
 * Represents a FoundryVTT journal entry with its pages and folder information.
 */
export interface FoundryJournal {
	journalId: string;
	journalName: string;
	flags: any;
	ownership: any;
	folderId: string;
	folderName: string;
	folderTree: FoundryFolderTreeNode[];
	fullFolderPath: string;
	pages: FoundryJournalPage[];
}

export interface FoundryHtml {
	html: string;
	foundryLinks: FoundryHtmlLinkInformation[];
	obsidianUUID: string;
	//obsidianFileName: string;
	//obsidianFilePath: string;
	obsidianFileObj: TFile;
	//obsidianFileModificationTime: number;
	//obsidianFileHash?: string;
	//obsidianFileHashName?: string;
	//obsidianFileExtension: string;
	//obsdianLinksRemaining: number; // number of links that still need to be resolved in the html

	//folderId: string; // id of the folder where the journal is stored
	//journalId: string; // id of the journal where the page is stored
	//pageId: string; // id of the page in the journal
	//pageTitle: string; // title of the page in the journal
}

export interface FoundryHtmlLinkInformation {
	obsidianNoteUUID: string; // the Obsidian UUID of the note/page
	linkPath: string; // path to the note in Obsidian
	linkText: string; // text of the link in Foundry
	linkDestinationUUID: string; // destination of the link in Foundry
	isAnkerLink: boolean; // true if the link is an anchor link, false if it is a normal link
	ankerLink: string; // the anchor link if it is an anchor link, empty string otherwise
	linkResolved: boolean;
}

/*
export interface ObsidianUUID {
	obsidianUUID: string; // the UUID of the note in Obsidian
	obsidianFilePath: string; // the path to the note in Obsidian	
}*/

interface ObsdianFrontmatterInfo {
	folderDestinationName: string; // the name of the folder where the journal is stored
	journalDestinationName: string; // the name of the journal where the page is stored
	isPage: boolean; // true if the page is a page onle, false if it is also a journal
	pageTitle: string; // title of the page in the journal
	pageId: string; // id of the page in foundry
	pictureDestinationPath: string; // path to the picture folder in Foundry
}

export function generateIdForFile(app: App, file: TFile): string {
	let UUID = "";
	if (!file) {
		throw new Error("Note file is not defined");
	}
	if (file) {
		// generate a new UUID for the file if it does not have one
		UUID = app.metadataCache.getFileCache(file)?.frontmatter?.UUID ?? Foundry.generateFoundryID(app) ?? "";
		// if no UUID is found in the frontmatter then generate a new one
		Foundry.workMapUUID.set(UUID, file.path);
		// add the UUID to the work map	
		app.fileManager.processFrontMatter(file, frontmatter => {
			if (!frontmatter["UUID"]) {
				frontmatter["UUID"] = UUID;
			}
		}).catch(err => {
			console.error("Failed to process frontmatter for UUID write:", err);
		});
	}
	return UUID;
}

export async function apiPost_CreateFoundryMacro(apiKey: string, clientId: string, relayServer: string): Promise<any> {
	debug.log("apiPost_CreateFoundryMacro function was started")
	//$baseUrl/execute-js?clientId=$clientId

	if (!apiKey || !clientId || !relayServer) return "";

	const calltype = "/execute-js?clientId=" + clientId; //executes a script!
	const url = relayServer + calltype;
	const scriptObj = { script: MACRO_CREATE_CODE };
	
	const bodyJSON = JSON.stringify(scriptObj);

	const requestParams: RequestUrlParam = {
		url: url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
		},
		body: bodyJSON,
	};

			//let response: any = []
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiPost_CreateFoundryMacro error: ", error.message);
				}
			debug.log("apiPost_CreateFoundryMacro response data: ",response ?? "No data could be retrieved")
			
	const macroResponse = response?.json?.result ?? []
	return macroResponse
}



/**
 * The Foundry class provides static and instance methods for interacting with a Foundry VTT instance,
 * including exporting notes, folders, journals, and images from Obsidian to Foundry via a REST API relay.
 * 
 * Static properties hold shared state and configuration for the Foundry connection, including API keys,
 * relay server URLs, session and client IDs, and collections of folders, journals, pages, and images.
 * 
 * Instance properties represent the state of a single note being processed for export, including its
 * metadata, HTML content, links, and destination information in Foundry.
 * 
 * Key features:
 * - Initialization of Foundry connection and session management (headless or standard).
 * - Mapping and management of UUIDs between Obsidian and Foundry.
 * - Creation and updating of folders, journals, and pages in Foundry.
 * - Reading and writing of frontmatter metadata in Obsidian notes.
 * - Uploading and management of image files from Obsidian to Foundry.
 * - Utility functions for ID generation, existence checks, and building internal maps.
 * 
 * Methods are designed to be used in the context of an Obsidian plugin, leveraging Obsidian's API
 * for file and metadata management, and Foundry's REST API for remote operations.
 * 
 * Error handling is provided for API calls, with notifications shown in Obsidian and browser.
 * 
 * @remarks
 * - Requires Obsidian and Foundry REST API relay to be properly configured.
 * - Many methods are asynchronous and return Promises.
 * - Static properties must be initialized via {@link Foundry.init} before use.
 * - Designed for batch and single-note export workflows.
 */
export class Foundry {
	static app: App;
	static settings: MarkdownToFoundrySettings;
	static xxhashAPI: XXHashAPI;

	static workMapUUID: Map<string, string>; // a map to work with the UUIDs and file paths
	static obsidianUUIDs: Map<string, string>; // Map of Obsidian UUIDs to file paths
	static foundryUUIDs: Map<string, string>; // Map of Foundry UUIDs to file paths

	static foundryApiKey: string; // same key for different connected sessions
	static foundryRelayServer: string; // same for different connected sessions
	static apiRunning: boolean; // true if the foundry API is running and can be contacted
	static sessionId: string;

	static clientId: string; // currently used foundry client id
	static folderList: FoundryFolder[]; // a list of all folders on the foundry instance
	static folderIdMap: Map<string, FoundryFolder>;
	static folderPathMap: Map<string, FoundryFolder>; // a map of folder paths to folder objects
	static journalList: FoundryJournal[]; // a list of all journals on the foundry instance
	static journalIdMap: Map<string, FoundryJournal>;
	static journalPathMap: Map<string, FoundryJournal>; // a map of journal paths to journal objects
	static pageList: FoundryJournalPage[]; // a list of all pages on the foundry instance
	static pageIdMap: Map<string, FoundryJournalPage>;
	static pagePathMap: Map<string, FoundryJournalPage>; // a map of page paths to page objects

	static foundryPictureCollection: FoundryFile[]; // same for all pages which upload pictures
	static ObsidianPictureCollection: ObsidianPicture[];

	private noteObsidianUUID: string; // the Obsidian UUID of the note
	private noteFile: TFile;
	private noteFoundryLinks: FoundryHtmlLinkInformation[];
	private noteHtml: string; // the html of the note to be uploaded to Foundry	
	private noteVault: Vault; // the vault of the note
	private noteFilePath: string; // the path of the note in the vault
	private noteTitle: string; // the title of the note
	private noteHash: string; // the hash of the note, if available, otherwise empty string
	private noteCtime: number; // the creation time of the note, might not be available in all cases, filesystem dependent
	private noteMtime: number; // the modification time of the note
	private noteUploadTime: number; // the time when the note was uploaded to Foundry, set to current time
	private noteUnresolvedLinks: number;
	private noteOwnership: number;

	private noteFolderDestinationName: string;
	private noteFolderDestinationId: string;
	private noteJournalDestinationName: string;
	private noteJournalDestinationId: string;
	private noteIsPage: boolean;
	private notePageTitle: string;
	private notePictureDestinationPath: string;
	private notePageId: string;
	private noteFolderParentId: string;


	constructor(app: App, foundryHtml: FoundryHtml, frontMatter: ObsdianFrontmatterInfo) {
		this.noteObsidianUUID = foundryHtml.obsidianUUID; // the Obsidian UUID of the note
		this.noteFile = foundryHtml.obsidianFileObj; //Obsidian File Object of the note
		this.noteFoundryLinks = foundryHtml.foundryLinks; // the links in the note to be uploaded to Foundry
		this.noteHtml = foundryHtml.html; // the html of the note to be uploaded to Foundry

		this.noteVault = foundryHtml.obsidianFileObj.vault; // the vault of the note,
		this.noteFilePath = foundryHtml.obsidianFileObj.path; // the path of the note in the vault,
		this.noteTitle = foundryHtml.obsidianFileObj.basename; // the title of the note,
		this.noteHash = ""; // the hash of the note, if available, otherwise empty string
		this.noteCtime = foundryHtml.obsidianFileObj.stat.ctime ?? 0; // the creation time of the note, might not be available in all cases, filesystem dependent
		this.noteMtime = foundryHtml.obsidianFileObj.stat.mtime; // the modification time of the note,
		this.noteUploadTime = Date.now(); // the time when the note was uploaded to Foundry, set to current time	

		this.noteFolderDestinationName = frontMatter.folderDestinationName; // the name of the folder where the journal is stored
		this.noteFolderDestinationId = ""; // the id of the folder where the journal is stored, to be set later
		this.noteJournalDestinationName = frontMatter.journalDestinationName; // the name of the journal where the page is stored
		this.noteJournalDestinationId = ""; // the id of the journal where the page is stored, to be set later
		this.noteIsPage = frontMatter.isPage; // true if the page is a page only, false if it is also a journal
		this.notePageTitle = frontMatter.pageTitle; // title of the page in the journal
		this.notePageId = frontMatter.pageId; // id of the page in foundry, to be set later
		this.notePictureDestinationPath = frontMatter.pictureDestinationPath; // path to the picture folder in Foundry
		this.noteFolderParentId = "";
		this.noteOwnership = -1;
		this.noteUnresolvedLinks = foundryHtml.foundryLinks.length;

	}

	async apiPost_CreateLinking(apiKey: string, clientId: string, relayServer: string): Promise<any> {
		//$baseUrl/execute-js?clientId=$clientId
	
		if (!apiKey || !clientId || !relayServer) return "";
		
		const calltype = "/execute-js?clientId=" + clientId; //executes a script!
		const url = relayServer + calltype;
		const scriptObj = { script: LINK_UPDATE_CODE };
		
		const bodyJSON = JSON.stringify(scriptObj);

		const requestParams: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: bodyJSON,
		};

			//let response: any = []
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiPost_CreateLinking error: ", error.message);
				}
			debug.log("apiPost_CreateLinking response data: ",response ?? "No data could be retrieved")
			
		const macroResponse = response?.json?.result ?? []
		return macroResponse
	}
	//function creates a single or several folders as required by frontmatter or settings
	async createFolderChain(
		apiKey: string,
		clientId: string,
		relayServer: string,
		fullPath: string
	): Promise<string> {
		const parts = fullPath.split("/");

		let currentPath = "";
		let lastExistingFolderPath = "";
		this.noteFolderParentId = "root"; //or none or empty ???
		let parentFolderId = "root"
		// Step 1: Find the longest existing folder path
		for (let i = 0; i < parts.length; i++) {
			if (currentPath) {
				currentPath = `${currentPath}/${parts[i]}`;
			} else {
				currentPath = parts[i];
			}

			if (Foundry.folderPathMap.has(currentPath)) {
				lastExistingFolderPath = currentPath;
			} else {
				break; // stop at first non-existent path
			}
		}

		// parentFolderId is the id of the last existing folder, or root if none exists

		if (lastExistingFolderPath !== "root") {
			if (lastExistingFolderPath) {
				parentFolderId = Foundry.folderPathMap.get(lastExistingFolderPath)!.id;
			}

			// Step 2: Create missing folders beyond the last existing folder path
			// Start creation from the next part after lastExistingFolderPath
			const startIndex = lastExistingFolderPath ? lastExistingFolderPath.split("/").length : 0;
			currentPath = lastExistingFolderPath;
			for (let i = startIndex; i < parts.length; i++) {
				const part = parts[i];
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				this.noteFolderParentId = parentFolderId
				// Create folder since it does not exist
				const newFolderId = await this.apiPost_CreateFolder(apiKey, clientId, relayServer, part, parentFolderId);

				// Update parentFolderId for next iteration
				parentFolderId = newFolderId;

				// Update the map for the newly created folder path
				//Foundry.folderPathMap.set(currentPath, { id: newFolderId });
			}
		}
		// Return the deepest folder ID at the end
		return parentFolderId;
	}
	// creates or updates a page - creation goes like this: create Journal => create page/updated page for batch import creates and updates should be bundled
	async createOrUpdatePage() {
		debug.log("Create or Update Pages function started")
		const todo = {
			createPage: false, // true if the page needs to be created
			updatePage: false, // true if the page needs to be updated
			pageFound: false, // true if the page was found in Foundry
			pageNeedsFolder: false, // true if the page needs a folder to be created
			pageNeedsJournal: true, // true if the page needs a journal to be created				
		}

		if (this.notePageId) {
			//Note has UUID and is for update
			if (Foundry.pagePathMap.has(this.notePageId)) {
				// if the page exists in the page map then update it
				const pageData = Foundry.pagePathMap.get(this.notePageId);
				if (pageData) {
					this.noteJournalDestinationId = pageData.journalId || ""// update the journal id
					this.noteFolderDestinationId = pageData.folderId || ""// update the folder id
					todo.pageFound = true; // the page was found in Foundry
					todo.pageNeedsJournal = false; // the page does not need a journal to be created
					todo.pageNeedsFolder = false; // the page does not need a folder to be created
					todo.updatePage = true; // the page needs to be updated
				}
			}
		}

		if (!todo.pageFound) {
			// check if a folder needs to be created
			
			if (this.noteFolderDestinationName) {
				const pathMap = Foundry.folderPathMap.has(this.noteFolderDestinationName) ?? ""
				if (pathMap) {
					// if the folder exists in the folder map then set the folder id
					const folderData = Foundry.folderPathMap.get(this.noteFolderDestinationName);
					if (folderData) {
						//Import folder WAS found
						this.noteFolderDestinationId = folderData.id; // update the folder id
						todo.pageNeedsFolder = false; // the page does not need a folder to be created
					}
				} else {
					//Import Folder was not found
					const lastFolderid = await this.createFolderChain(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer, this.noteFolderDestinationName)

					if (lastFolderid === "root") {
						this.noteFolderParentId = "root"
					} else {
						this.noteFolderDestinationId = lastFolderid
					}
					todo.pageNeedsFolder = false; // the page needs a folder to be created
					todo.pageNeedsJournal = true
					todo.createPage = true; // the page needs to be created

				}
			}

			// check if a journal needs to be created				
			if (this.noteJournalDestinationName && todo.pageNeedsJournal) {
				const destination = this.noteFolderDestinationName + "/" + this.noteJournalDestinationName;
				if (Foundry.journalPathMap.has(destination)) {
					// if the journal exists in the journal map then set the journal id
					const journalData = Foundry.journalPathMap.get(destination);
					if (journalData) {
						this.noteJournalDestinationId = journalData.journalId; // update the journal id
						todo.pageNeedsJournal = false; // the page does not need a journal to be created
						todo.updatePage = true
					}
				} else {
					//todo.pageNeedsJournal = true; // the page needs a journal to be created
					debug.log(`Destination Journal was not found a new one names ${this.noteJournalDestinationName} will be created`)
					this.noteJournalDestinationId = await this.apiPost_CreateJournal(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer, this.noteJournalDestinationName, this.noteFolderDestinationId)
					todo.pageNeedsJournal = false
					todo.createPage = true
				}
			}

			//check if a page in a journal exists or if it needs to be created
			if (this.noteJournalDestinationName && this.notePageTitle) {
				// no pageID but try to get the path from the pagePathMap
				const destination = this.noteFolderDestinationName + "/" + this.noteJournalDestinationName + "." + this.notePageTitle;
				if (Foundry.pagePathMap.has(destination)) {
					// if the page exists in the page map then set the page id
					const pageData = Foundry.pagePathMap.get(destination);
					if (pageData) {
						this.notePageId = pageData.pageId; // update the page id
						todo.pageFound = true; // the page was found in Foundry
						todo.updatePage = true; // the page needs to be updated
						todo.createPage = false;
					}
				} else {
					todo.createPage = true; // the page needs to be created
					todo.updatePage = false;
				}
			}
		}

		let updateFrontmatter = false
		if (todo.updatePage) {
			debug.log("A page update is necessary")
			this.notePageId = await this.apiPut_CreatePage(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer)
			updateFrontmatter = false
			//the assignment should not be necessary as this is an update and the id shoul be existent
			// Update Page
		}

		if (todo.createPage) {
			debug.log("A page create is necessary")
			updateFrontmatter = true
			// create a Page in a journal
			// possibly this needs to include the following steps also
			// set Foundry.pageID = ""
			//// remove VTT_UUID and set it to "" so it can be filled again
			// so in effect by changing folder or name the note gets recreated as new
			this.notePageId = ""
			this.notePageId = await this.apiPut_CreatePage(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer)
		}

		// FIXME: For Batch an update of all folders and journals needs to be made!

		if (Foundry.settings.foundryWriteFrontmatter) {
			this.writeFrontmatter(Foundry.app, this.noteFile, updateFrontmatter)
		}

		if (Foundry.settings.foundryMacroLinkingRun) {
			debug.log("Linking run started")
			await this.apiPost_CreateLinking(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer)
		}
	}

	static async initFoundryPageObject(app: App, foundryHtml: FoundryHtml): Promise<Foundry> {
		const frontmatterInfo = await Foundry.readFrontmatter(app, foundryHtml.obsidianFileObj);
		return new Foundry(app, foundryHtml, frontmatterInfo);
	}

	static async readFrontmatter(app: App, file: TFile): Promise<ObsdianFrontmatterInfo> {
		debug.log("Frontmatter read started - working on file:", file.path)
		//let frontMatterCache = app.metadataCache.getFileCache(file)?.frontmatter // not used any more in this function just for console.log out!
		//console.log("Frontmatter Cache: ", frontMatterCache)

		let frontmatterInfo: ObsdianFrontmatterInfo = {
			folderDestinationName: "",
			journalDestinationName: "ObsidianExport", // default to Obsidian, can be overwritten by frontmatter
			isPage: true, // default to true, can be overwritten by frontmatter
			pageTitle: file.basename, // default to file basename, can be overwritten by frontmatter
			pageId: "",
			pictureDestinationPath: "assets/pictures"
		};

		/* dynamic picture path selection
				let picturePath = "assets/pictures";
									if (Foundry.settings.foundrySettingsUsed) {
										// 'file' is a TFile object representing the note
										picturePath = Foundry.settings.foundryPicturePath || "assets/pictures"
										if (Foundry.settings.foundryWriteFrontmatter) {
										await Foundry.app.fileManager.processFrontMatter(this.activeFile, frontmatter => {
											picturePath =
												frontmatter["VTT_PicturePath"] || Foundry.settings.foundryPicturePath || "assets/pictures";
										});}
									}*/
	
		if (Foundry.settings.foundrySettingsUsed) {
			// Only options available in the Foundry settings need to be set
			frontmatterInfo.folderDestinationName = Foundry.settings.foundryFolder || "";
			frontmatterInfo.journalDestinationName = Foundry.settings.foundryJournal || "ObsidianExport";
			frontmatterInfo.pictureDestinationPath = Foundry.settings.foundryPicturePath || "assets/pictures";


			// Check if foundry export is selected an read frontmatter for foundry
			if (Foundry.settings.foundryWriteFrontmatter) {
				// 'file' is a TFile object representing the note
				let result = await app.fileManager.processFrontMatter(file, frontmatter => {
					if (frontmatter) {
						frontmatterInfo.folderDestinationName = frontmatter["VTT_Folder"] || "";
						frontmatterInfo.journalDestinationName = frontmatter["VTT_Journal"] || Foundry.settings.foundryJournal || "ObsidianExport";
						if (frontmatterInfo.journalDestinationName === "ObsidianExport") {
							frontmatterInfo.isPage = true;
						} else {
							frontmatterInfo.isPage = frontmatter["VTT_Page"] ?? false;
						}
						frontmatterInfo.pageTitle = frontmatter["VTT_PageTitle"] || file.basename;
						frontmatterInfo.pageId = frontmatter["VTT_UUID"] || "";
						frontmatterInfo.pictureDestinationPath = frontmatter["VTT_PicturePath"] || Foundry.settings.foundryPicturePath || "assets/pictures";
					}
				});
				//FIXME: NEW no frontmatter is returned in STEP3 if the note does not have one as nothing is returned with the await function!!
				//Also check what you want as standard Journal name! Obsidian or ObsidianExport!
			}
		}
		return frontmatterInfo;
	}

	/**
	 * Initialize the common static properties of the class
	 * @param {App} app - The app object of Obsidian
	 * @param {number} settings - Holds the current active profile settings of the plugin.
	 *
	 * additional static properties to be initialized are:
	 * foundryApiKey: Needed for accessing the foundry rest API
	 * foundryRelayServer: Holding the information which relay server to use
	 * apiRunning: REST call to check if foundry API can be contacted
	 * clientId: REST call to get the foundry id which is a combination of the foundry instance running (world on server) AND the logged in user (GM)
	 * folderList: REST call to get the folder list of the Foundry instance
	 * foundryPictureCollection: REST call "fetchFolderList" to get all picture file paths on the foundry instance
	 */
	//
	static async init(app: App, settings: MarkdownToFoundrySettings) {
		debug.log("INIT for Foundry export was executed")
		Foundry.app = app;
		Foundry.settings = settings;
		Foundry.foundryApiKey = settings.foundryApiKey || "";
		// Check if all required settings for a connection to Foundry are set
		// Check if the API key is set
		try {
			if (Foundry.foundryApiKey === "") {
				throw new Error("NO API key specified!");
			}

			Foundry.foundryRelayServer = settings.foundryRelayServer || "";
			if (Foundry.foundryRelayServer === "") {
				throw new Error("NO relay server specified!");
			}

			Foundry.apiRunning = await Foundry.apiGet_APIStatus(Foundry.foundryRelayServer, Foundry.foundryApiKey);
			if (!Foundry.apiRunning) {
				throw new Error("Foundry or relay Server is not running");
			}
			//check if a manual session is wanted

			Foundry.clientId = ""; // set the client id to an empty string
			if (settings.foundryHeadlessUsed) {
				Foundry.sessionId = "";
				Foundry.clientId = await Foundry.apiPost_startHeadlessSession(Foundry.foundryRelayServer, Foundry.foundryApiKey, settings); //start a session with the relay server and get the client id
			} else {
				Foundry.clientId = await Foundry.apiGet_ClientId(Foundry.foundryRelayServer, Foundry.foundryApiKey); // fetch the client id of the current session
			}




			// fill the static properties with the initial values

			Foundry.workMapUUID = new Map<string, string>(); // initialize the work map for UUIDs
			Foundry.obsidianUUIDs = new Map<string, string>(); // initialize the Obsidian UUIDs map
			Foundry.foundryUUIDs = new Map<string, string>(); // initialize the Foundry UUIDs map
			
			Foundry.journalIdMap = new Map<string, FoundryJournal>()
			Foundry.pageIdMap = new Map<string, FoundryJournalPage>()
			Foundry.journalPathMap = new Map<string, FoundryJournal>()
			Foundry.pagePathMap = new Map<string, FoundryJournalPage>()
			Foundry.folderIdMap = new Map<string, FoundryFolder>(); // the static property also needs to be initialized because if there are no folders she is not properly filled
			Foundry.folderPathMap = new Map<string, FoundryFolder>(); // the static property also needs to be initialized because if there are no folders she is not properly filled



			// fill the folder list with the folders of the foundry instance
			Foundry.folderList = [];
			Foundry.folderList = await Foundry.apiGet_AllFolders(Foundry.foundryRelayServer, Foundry.foundryApiKey, Foundry.clientId);

			// fill the folder list with the folders of the foundry instance
			Foundry.journalList = [];
			Foundry.journalList = await Foundry.apiGet_AllJournals(Foundry.foundryRelayServer, Foundry.foundryApiKey, Foundry.clientId);
		
			Foundry.pageList = Foundry.buildPageAndJournalArraysAndMaps(); // builds the sets and maps for journals+pages and addionally a pages array
			Foundry.buildFolderArrayAndMaps(); // builds the sets and maps for folders and additionally a folder array

			//TODO: Add the foundry obsidian UUIDs to the foundry UUIDs map
			//Foundry.foundryUUIDs = Foundry.buildFoundryUUIDs(Foundry.journalList, Foundry.pageList, Foundry.folderList);
			this.idExists(app, "init", Foundry.foundryUUIDs); // this will initialize the obsidianUUIDs map if it is not already initialized

			Foundry.foundryPictureCollection = [];
			Foundry.foundryPictureCollection = await Foundry.apiGet_AllPictureFilePaths(Foundry.foundryRelayServer, Foundry.foundryApiKey, Foundry.clientId);
			
			// this is the basic intialization of ObsdianPictureCollection. It gets filled with the pictures of the current note(s) later
			// this is done with Foundry.buildPictureUploadList(noteFile, html) later when it is clear how many notes to be processed
			Foundry.ObsidianPictureCollection = []; //init the upload picture collection
			Foundry.xxhashAPI = await xxhash(); // init the hasher object
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
			showBrowserNotification("Error: ", { body: message }); //TODO: decide if both messages make sense or just use one and which // or none
		}
	}



	/**
	 * Builds a list of all pages from all journals in Foundry.journalList.
	 * Additionally builds sets and maps for journals and pages.
	 * - Foundry.journalIdSet: Set of all journal IDs.
	 * - Foundry.pageIdSet: Set of all page IDs.
	 * - Foundry.journalIdMap: Map of journalId to journal object.
	 * - Foundry.pageIdMap: Map of pageId to page object.
	 * @returns {FoundryJournalPage[]} An array of all journal pages.
	 */
	static buildFolderArrayAndMaps() {
		const allFolders: FoundryFolder[] = [];
		const folderIdMap = new Map<string, FoundryFolder>();
		const folderPathMap = new Map<string, FoundryFolder>(); // a map of folder paths to folder objects
		//Foundry.folderIdMap = new Map<string, FoundryFolder>(); // the static property also needs to be initialized because if there are no folders she is not properly filled
		//Foundry.folderPathMap = new Map<string, FoundryFolder>(); // the static property also needs to be initialized because if there are no folders she is not properly filled

		if (!Array.isArray(Foundry.folderList)) return allFolders;

		for (const folder of Foundry.folderList) {
			if (folder.id) {
				folderIdMap.set(folder.id, folder);
				folderPathMap.set(folder.fullFolderPath, folder);
			}
			allFolders.push(folder);
		}

		// Save the sets and maps as static properties for later use
		Foundry.folderIdMap = folderIdMap;
		Foundry.folderPathMap = folderPathMap;
	
		return allFolders;
	}

	static buildPageAndJournalArraysAndMaps(): FoundryJournalPage[] {
		const allPages: FoundryJournalPage[] = [];
		const journalIdMap = new Map<string, FoundryJournal>();
		const pageIdMap = new Map<string, FoundryJournalPage>();
		const journalPathMap = new Map<string, FoundryJournal>(); // a map of journal paths to journal objects
		const pagePathMap = new Map<string, FoundryJournalPage>(); // a map of page

		if (!Array.isArray(Foundry.journalList)) return allPages;

		for (const journal of Foundry.journalList) {
			if (journal.journalId) {
				journalIdMap.set(journal.journalId, journal);
				journalPathMap.set(journal.fullFolderPath + "/" + journal.journalName, journal);
			}
			if (Array.isArray(journal.pages)) {
				for (const page of journal.pages) {
					if (page.pageId) {
						pageIdMap.set(page.pageId, page);
						pagePathMap.set(page.fullFolderPath + "/" + page.journalName + "." + page.pageName, page);
					}
					allPages.push(page);
				}
			}
		}

		// Save the sets and maps as static properties for later use
		Foundry.journalIdMap = journalIdMap;
		Foundry.pageIdMap = pageIdMap;
		Foundry.journalPathMap = journalPathMap;
		Foundry.pagePathMap = pagePathMap;

		return allPages;
	}

	/**
	 * Checks if a given ID exists in any of the UUID sets: Obsidian frontmatter UUIDs, Foundry UUIDs, or an additional set.
	 * If the Obsidian UUID set is empty, it fetches and updates it from the frontmatter of all markdown files.
	 * Merges all available UUIDs into a single set and checks for the presence of the specified ID.
	 *
	 * @param {App} app - The Obsidian app instance, used to fetch frontmatter UUIDs if needed.
	 * @param {string} id - The ID to check for existence.
	 * @param {Set<string>} [setOfId] - An optional additional set of IDs to include in the check.
	 * @returns {boolean} True if the ID exists in any of the UUID sets, false otherwise.
	 */
	static idExists(app: App, id: string, setOfId?: Map<string, string>): boolean {
		let workMap: Map<string, string> = Foundry.workMapUUID ?? new Map<string, string>();
		//Initialize all possible set lists
		let UUID_List_obsidian = Foundry.obsidianUUIDs ?? new Map<string, string>();
		//const UUID_List_foundry = Foundry.foundryUUIDs ?? workSet
		const UUID_List_additional = setOfId ?? new Map<string, string>();

		Foundry.obsidianUUIDs = Foundry.obsidianUUIDs ?? []
		// if there is no obsidian set then the list was not initially filled yet
		if (Foundry.obsidianUUIDs.size === 0) {
			// fetch the actual list of obsidian UUID
			UUID_List_obsidian = Foundry.fetchFrontmatterUUIDs(app)
			// update the obsidian UUID list
			Foundry.obsidianUUIDs = UUID_List_obsidian
		}

		// merge all Maps
		// for each returns value first and then the key by definition of Map
		workMap.forEach((value, key) => {
			UUID_List_obsidian.set(key, value);
		});

		//for (const value of UUID_List_foundry){
		//workSet.add(value)
		//}
		if (UUID_List_additional) {
			workMap.forEach((value, key) => {
				UUID_List_additional.set(key, value);
			});
		}

		// return true if an id is part of the id lists retrieved
		return workMap.has(id);
	}

	public static generateFoundryID(app: App, setOfId?: Map<string, string>): string {
		//
		let flag: Boolean = true;
		let foundryID = "";

		do {
			foundryID = Foundry.generateID(16)
			flag = Foundry.idExists(app, foundryID)
		}
		while (flag);
		return foundryID
	}

	static generateID(length: number): string {
		const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		const result = [];
		const values = new Uint8Array(length);
		/*  Node.js's native crypto module does not implement a method called getRandomValues
			crypto.getRandomValues() is a Web API exposed on the window.crypto or globalThis.crypto object in browsers.
			It is part of the Web Crypto API used for cryptographically secure random number generation
			as Foundry seems to use this crypto implementation I stayed with it and use the crypto equivalent
			crypto.webcrypto.getRandomValues()
			see: https://foundryvtt.com/api/v12/functions/foundry.utils.randomID.html
		*/
		crypto.webcrypto.getRandomValues(values) // crypto
		for (let i = 0; i < length; i++) {
			// Map the random byte to an index of charset with a modulo operation => lefover is a multiple of charset.length
			const randomIndex = values[i] % charset.length;
			result.push(charset[randomIndex]);
		}
		return result.join('');
	}

	static async apiPost_startHeadlessSession(relayServer: string, apiKey: string, setting: MarkdownToFoundrySettings): Promise<string> {
		// https://github.com/ThreeHats/foundryvtt-rest-api-relay/wiki/start-session-POST

		let clientId = "";
		const BASE_URL = relayServer; // 'https://foundryvtt-rest-api-relay.fly.dev'
		const API_KEY = apiKey //"594b67e3f99614725d8092589cf86131" //apiKey; // Replace with your actual API key
		const FOUNDRY_URL = this.settings.foundryIP;//http://localhost:30000'; // Replace with your actual Foundry URL
		const USERNAME = this.settings.foundryUser; // Replace with your actual username
		const PASSWORD = this.settings.foundryPW; // Replace with your actual password
		const WORLD_NAME = this.settings.foundryWorld; // Replace with your actual world name

		let calltype = "/session-handshake";
		let url = relayServer + calltype;

		try {
			// Step 1: Handshake
			let requestParams: RequestUrlParam = {
				url: url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					'x-api-key': API_KEY,
					'x-foundry-url': FOUNDRY_URL,
					'x-username': USERNAME,
					'x-world-name': WORLD_NAME
				},
			};
		
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					debug.log("apiPost_startHeadlessSession/handshake error: ", error.message);
				}
			debug.log("apiPost_startHeadlessSession/handshake response data: ",response ?? "No data could be retrieved")

			const { token, publicKey, nonce } = response?.json;
			// Step 2: Encrypt password and nonce
			const dataToEncrypt = JSON.stringify({ password: PASSWORD, nonce });
			const encryptedPassword = crypto.publicEncrypt(
				{
					key: publicKey,
					padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
					oaepHash: 'sha1'
				},
				Buffer.from(dataToEncrypt)
			).toString('base64');

			// Step 3: Start session
			calltype = "/start-session";
			url = relayServer + calltype;
			const bodyJSON = JSON.stringify({
				handshakeToken: token, encryptedPassword
			});

			requestParams = {
				url: url,
				method: "POST",
				headers: {
					'x-api-key': API_KEY,
					'Content-Type': 'application/json'
				},
				body: bodyJSON,
			};

			response = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiPost_startHeadlessSession/session error: ", error.message);
				}
			debug.log("apiPost_startHeadlessSession/session response data: ",response ?? "No data could be retrieved")
			
			clientId = response?.json?.clientId || ""
			Foundry.sessionId = response?.json?.sessionId || ""
		} catch (error) {
			if (!clientId) {
				console.error('Error:', error.response?.json || error.message);
				throw new Error("No client Id could be retrieved! No Foundry session is active or your specified session could not be retrieved!");
			}
			console.error('Error:', error.response?.json || error.message);
		}

		return clientId ?? ""
	} // End of session function

	static async apiDelete_endHeadlessSession(relayServer: string, apiKey: string, sessionId: string): Promise<string> {
		// https://github.com/ThreeHats/foundryvtt-rest-api-relay/wiki/start-session-POST

		//$baseUrl/end-session?sessionId=id
		const SESSION_ID = sessionId
		const API_KEY = apiKey //"594b67e3f99614725d8092589cf86131" //apiKey; // Replace with your actual API key

		const BASE_URL = relayServer; // 'https://foundryvtt-rest-api-relay.fly.dev'
		const FOUNDRY_URL = this.settings.foundryIP;//http://localhost:30000'; // Replace with your actual Foundry URL
		const USERNAME = this.settings.foundryUser; // Replace with your actual username
		const PASSWORD = this.settings.foundryPW; // Replace with your actual password
		const WORLD_NAME = this.settings.foundryWorld; // Replace with your actual world name

		let calltype = "/end-session?sessionId=" + sessionId;
		let url = relayServer + calltype;

		let response: any = {};
		try {
			// Step 1: Handshake
	
			let requestParams: RequestUrlParam = {
				url: url,
				method: "DELETE",
				headers: {
					"Content-Type": "application/json",
					'x-api-key': API_KEY,
					'sessionId': SESSION_ID
				},
			};
		
		try {
			response = await requestUrl(requestParams);
		if (response?.status !== 200) {
			throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
			}
		} catch (error) {
			console.error("M2F: apiDelete_endHeadlessSession error: ", error.message);
			}
		debug.log("apiDelete_endHeadlessSession response data: ",response ?? "No data could be retrieved")		
		
	} catch (error) {
			console.error('Error:', error.response?.json || error.message);
			throw new Error("There was a Problem with ending your Session");

		}

		return response ?? ""
	} // End of session function

	static async apiGet_APIStatus(relayServer: string, apiKey: string): Promise<boolean> {
		debug.log("apiGet_APIStatus function started")
		const calltype = "/api/status";
		const url = relayServer + calltype;
		let apiRunning = false;
		const requestParams: RequestUrlParam = {
			url: url,
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
		};
		let response: any = {}
		try {
		response = await requestUrl(requestParams);
		if (response?.status !== 200) {
			throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
		}
		} catch (error) {
		console.error("M2F: apiGet_APIStatus error: ", error.message);
		}
		debug.log("apiGet_APIStatus response data: ",response ?? "No data could be retrieved")


		if (response?.json?.status === "ok") {
			apiRunning = true;
		}
		return apiRunning;
	}

	static async apiGet_ClientId(relayServer: string, apiKey: string): Promise<string> {
		debug.log("apiGet_ClientId function entered")
		
		let clientId = "";
		const calltype = "/clients";
		const url = relayServer + calltype;

		const requestParams: RequestUrlParam = {
			url: url,
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
		};

		let response: any = {}
		try {
			response = await requestUrl(requestParams);
		if (response?.status !== 200) {
			throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
			}
		} catch (error) {
			console.error("M2F: apiGet_ClientId error: ", error.message);
		}
		debug.log("apiGet_ClientId response data: ",response ?? "No data could be retrieved")
		

		const clientList: any[] = response?.json?.clients ?? [];
		
		if (clientList.length > 0) {
			// at least one client exists
			if (this.settings.foundryClientId) {
				clientId = this.settings.foundryClientId ?? "";

				const filteredResponse: any[] = clientList.filter((client: any) => client?.id === clientId);
				if (filteredResponse.length === 0) {
					throw new Error("Your specified Foundry instance or session is not active or could not be retrieved!");
					// Make sure it is not an attempt to get the client list // maybe split the code and make a new function
				}
			} else {
				clientId = response?.json?.clients[0]?.id ?? "";
			}
		} else {
			clientId = "";
		}

		if (!clientId) {
			throw new Error("No client Id could be retrieved! No Foundry session is active or your specified session could not be retrieved!");
		}
		return clientId ?? ""; // return the foundry id or an empty string if no client was found
	}

	static async apiGet_FoundryClientList(relayServer: string, apiKey: string) {
		debug.log("Returned a LIST of connected clients: apiGet_FoundryClientList")
		const calltype = "/clients";
		const url = relayServer + calltype;

		const requestParams: RequestUrlParam = {
			url: url,
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
		};
		let response: any = {}
		try {
		response = await requestUrl(requestParams);
		if (response?.status !== 200) {
			throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
		}
		} catch (error) {
			console.error("M2F: apiGet_FoundryClientList error: ", error.message);
		}
		debug.log("apiGet_FoundryClientList retrieved: ", response ?? "Data could not be retrieved")
		
		const clientList: any[] = response?.json?.clients ?? [];

		return clientList;
	}

	static async apiGet_AllPictureFilePaths(relayServer: string, apiKey: string, clientId: string): Promise<FoundryFile[]> {
		let foundryPictureCollection: FoundryFile[] = [];

		//{{baseUrl}}/file-system?clientId={{clientId}}&recursive=true&path=/obsidian-files
		const calltype = "/file-system?clientId=" + Foundry.clientId + "&recursive=true&path=/";
		const url = relayServer + calltype;

		const requestParams: RequestUrlParam = {
			url: url,
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
		};

		
		
			let response:any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiGet_AllPictureFilePaths error: ", error.message);
				}
			debug.log("apiGet_AllPictureFilePaths response data: ",response ?? "No data could be retrieved")
			
		const toBeFiltered: FoundryFile[] = response?.json?.results ?? [] //response.json.files;
		
		type FoundryFileWithExtension = FoundryFile & { extension: string };

		function isFoundryFileWithExtension(
			file: FoundryFile | (FoundryFile & { extension: string }) | null
		): file is FoundryFileWithExtension {
			return !!file && "extension" in file;
		}

		const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"];

		const filteredPictures: FoundryFile[] = toBeFiltered
			.map(item => {
				// Find the extension that matches the end of the name
				const foundExt = imageExtensions.find(ext => item.name.toLowerCase().endsWith(ext));
				// If a matching extension is found, return a new object with the extension property
				if (foundExt) {
					return { ...item, extension: foundExt };
				}
				// Otherwise, return null
				return null;
			})
			.filter(isFoundryFileWithExtension);
		//.filter(Boolean)as FoundryFile[]; // Assert that the result is FoundryFile[] and containes no null even though I Remove nulls (items without a matching extension) but the compiler does not know that
		// alternativly use a typeguard and change .filter(isFoundryFile) and add a new typeguard function isFoundryFile

		if (filteredPictures.length > 0) {
			foundryPictureCollection = (foundryPictureCollection ?? []).concat(filteredPictures);
		}
		return foundryPictureCollection;
	}



	public async writeFrontmatter(app: App, file: TFile, update: boolean = false) {
		debug.log("writeFrontmatter is beeing executed")
		if (Foundry.settings.foundryWriteFrontmatter) {
			// Assume 'file' is a TFile object representing your note
			await app.fileManager.processFrontMatter(file, frontmatter => {
				//this probably makes no sense, either it is set by user or not
				//then again if something was set it will not be touched so in that case it makes sense?
				if (!update) {
					if (!frontmatter["VTT_Folder"]) {
						frontmatter["VTT_Folder"] = this.noteFolderDestinationName;
					}
					if (!frontmatter["VTT_Journal"]) {
						frontmatter["VTT_Journal"] = this.noteJournalDestinationName;
					}
					if (!frontmatter["VTT_PageTitle"]) { // Maybe there was a reason it was NOT !frontmatter?
						frontmatter["VTT_PageTitle"] = this.notePageTitle;
					}
					if (!frontmatter["VTT_Page"]) {
						frontmatter["VTT_Page"] = this.noteIsPage;
					}
					if (!frontmatter["VTT_PicturePath"]) {
						frontmatter["VTT_PicturePath"] = this.notePictureDestinationPath;
					}
					//  can probably be deleted up to this point ?

					if (!frontmatter["VTT_UUID"]) {
						frontmatter["VTT_UUID"] = this.notePageId;
					}
				}

				if (update) {
					frontmatter["VTT_Folder"] = this.noteFolderDestinationName;
					frontmatter["VTT_Journal"] = this.noteJournalDestinationName;
					frontmatter["VTT_PageTitle"] = this.notePageTitle;
					frontmatter["VTT_Page"] = this.noteIsPage;
					frontmatter["VTT_PicturePath"] = this.notePictureDestinationPath;
					frontmatter["VTT_UUID"] = this.notePageId;
				}
			});
		}
	}


	static async apiGet_AllFolders(relayServer: string, apiKey: string, clientId: string): Promise<FoundryFolder[]> {
		debug.log("apiGet_AllFolders got executed")
		//$baseUrl/execute-js?clientId=$clientId
		let folderList: FoundryFolder[] = [];
		
		if (!clientId) return folderList;
		const calltype = "/execute-js?clientId=" + clientId; //executes a script!
		const url = relayServer + calltype;

		let bodyString = GET_ALL_FOLDERS_CODE

		//bodyString=`console.log("Macro was executed")`
		const scriptObj = { script: bodyString };
		const bodyJSON = JSON.stringify(scriptObj);

		const requestParams: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: bodyJSON,
		};
		
			//let response: any = []
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiGet_AllFolders apiGet_AllFolders error: ", error.message);
				}
			debug.log("apiGet_AllFolders response data: ",response ?? "No data could be retrieved")
			
		folderList = response?.json?.result ?? [];

		const filteredResponse: any[] = folderList.filter((item: any) => item?.type === "JournalEntry");
		
		if (filteredResponse.length > 0) {
			folderList = filteredResponse ?? [];
		} else {
			folderList = [];
		}
		return folderList
	}


	static async apiGet_AllJournals(relayServer: string, apiKey: string, clientId: string): Promise<FoundryJournal[]> {
		debug.log("apiGet_AllJournals function entered")
		let journalList: FoundryJournal[] = [];
		//$baseUrl/execute-js?clientId=$clientId
		
		if (!clientId) return [];
		const calltype = "/execute-js?clientId=" + clientId; //executes a script!
		const url = relayServer + calltype;

		const bodyString = GET_ALL_JOURNALS_CODE;

		const scriptObj = { script: bodyString };
		const bodyJSON = JSON.stringify(scriptObj);

		const requestParams: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: bodyJSON,
		};

		
			// let response: any = []
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiGet_AllJournals error: ", error.message);
				}
			debug.log("apiGet_AllJournals response data: ",response ?? "No data could be retrieved")
			
		journalList = response?.json?.result ?? [];
		return journalList
	}

	async apiPost_CreateFolder(apiKey: string, clientId: string, relayServer: string, folderName: string, parentFolderId: string): Promise<string> {
		debug.log("apiPost_CreateFolder function started")
		//$baseUrl/execute-js?clientId=$clientId
		
		if (!apiKey || !clientId || !relayServer) return "";
		folderName = folderName || "ObsidianPlaceholder" //In case multiple backslashes are used and folderName is ""
		const calltype = "/execute-js?clientId=" + clientId; //executes a script!
		const url = relayServer + calltype;

		if (parentFolderId === "root") { parentFolderId = "null" } else { parentFolderId = `"${parentFolderId}"` }
		const bodyString = 
		`
			const response = await Folder.create({
				name: "${folderName}",
				type: "JournalEntry", // The type corresponds to the directory: "Actor", "Item", "JournalEntry", "Scene", "Macro", etc.
				folder: ${parentFolderId},  // Replace with another folder ID for a subfolder, or keep null for a root folder
				color: "#FF9900" // Optional: set a custom folder color
			});
			return response
		`;

		const scriptObj = { script: bodyString };
		const bodyJSON = JSON.stringify(scriptObj);

		const requestParams: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: bodyJSON,
		};
			//let response: any = []
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiPost_CreateFolder error: ", error.message);
				}
			debug.log("apiPost_CreateFolder response data: ",response ?? "No data could be retrieved")
			
		const folderId = response?.json?.result?._id ?? ""
		return folderId
	}


	public async apiPost_CreateJournal(apiKey: string, clientId: string, relayServer: string, journalName: string, folderId: string): Promise<string> {
		debug.log("apiPost_CreateJournal has started");
		const calltype = "/create?clientId=" + clientId;

		const url = relayServer + calltype;

		let JournalEntry = {};
		if (folderId === "") {
			JournalEntry = {
				entityType: "JournalEntry",
				data: {
					name: `${journalName}`,
					pages: [],
				},
			}
				;
		} else {
			JournalEntry = {
				entityType: "JournalEntry",
				folder: `${folderId}`,
				data: {
					name: `${journalName}`,
					pages: [],
				},
			};
		}

		const bodyJSON = JSON.stringify(JournalEntry);

		const requestParams: RequestUrlParam = {
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: bodyJSON,
		};
		
		
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiPost_CreateJournal error: ", error.message);
				}
			debug.log("apiPost_CreateJournal response data: ",response ?? "No data could be retrieved")
			
		const journalId = response?.json?.uuid ?? "";
		//The API returns JournalEntry.xxxIDxxx we need want to keept it consistent
		const parts = journalId.split('.');             // split by dot
		const returnJustTheId = parts[parts.length - 1];
		return returnJustTheId
	}

	public async apiPut_CreatePage(apiKey: string, clientId: string, relayServer: string): Promise<string> {
		debug.log("apiPut_CreatePage got executed")
		let returnPageId = ""
		//{{baseUrl}}/update?clientId={{clientId}}&uuid=JournalEntry.SZ4OjfnRipsVMbvX
		if (!this.noteJournalDestinationId) {
			throw new Error("NO journal found JOURNAL ID EMPTY");
		}
		const calltype = "/update?clientId=" + clientId + "&uuid=JournalEntry." + this.noteJournalDestinationId + "&selected=false";
		const url = relayServer + calltype;

		let updatePage = {};
		if (this.notePageId === undefined || this.notePageId === "") {
			// creates a new page as the page does not exist in the journal
			debug.log("apiPut_CreatePage - page CREATE in progress", this.noteHtml);
			updatePage = {
				"pages": [
					{
						"name": this.notePageTitle,
						"type": "text",
						"text": {
							content:this.noteHtml,
							format: 1,
						},
						"_id": "",
						"flags": {
							"markdowntofoundry": {
								"uuid": this.noteObsidianUUID ?? "",
								"vault": "",
								"filePath": this.noteFilePath ?? "",
								"noteTitle": this.noteTitle ?? "",
								"noteHash": this.noteHash ?? "",
								"cTime": this.noteCtime ?? "",
								"mTime": this.noteMtime ?? "",
								"uploadTime": this.noteUploadTime ?? "",
								"journalLinks": this.noteFoundryLinks ?? [],
								"unresolvedLinks": this.noteUnresolvedLinks ?? []	
							},
						},
						"title": {
							"show": true,
							"level": 1,
						},
						"ownership": {
							"default": this.noteOwnership,
						},
					},
				],
			};
		} else {
			debug.log("apiPut_CreatePage - page UPDATE in progress", this.noteHtml);
			// updates the page according to the page id
			updatePage = {
				pages: [
					{
						name: this.notePageTitle,
						type: "text",
						text: {
							content: this.noteHtml,
							format: 1,
						},
						_id: this.notePageId,
						flags: {
							markdowntofoundry: {
								uuid: this.noteObsidianUUID,
								vault: "",
								filePath: this.noteFilePath,
								noteTitle: this.noteTitle,
								noteHash: this.noteHash,
								cTime: this.noteCtime,
								mTime: this.noteMtime,
								uploadTime: this.noteUploadTime,
								journalLinks: this.noteFoundryLinks,
								unresolvedLinks: this.noteUnresolvedLinks
							},
						},
						title: {
							show: true,
							level: 1,
						},
						ownership: {
							default: this.noteOwnership,
						},
					},
				],
			};
		}
		const body = { data: updatePage };

		const newbody = JSON.stringify(body);
	
		const requestParams: RequestUrlParam = {
			url: url,
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: newbody,
		};

			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiPut_CreatePage error: ", error.message);
				}
			debug.log("apiPut_CreatePage response data: ",response ?? "No data could be retrieved")
		const pageList: any = response?.json?.entity?.[0]?.pages ?? []
		if (this.notePageId === undefined || this.notePageId === "") {
			const filteredResponse = pageList.filter(
				(item: any) => item?.name === this.notePageTitle
			);
			if (filteredResponse.length > 0) {
				returnPageId = filteredResponse[0]?._id ?? ""; // get the new id from filteredresponse which should be one page only. A page with a name and an _id
			} else {
				returnPageId = "";
			}
		}
		
		return returnPageId ?? ""
	}

	public static async apiPost_ListOfFiles() {
		debug.log("apiPost_ListOfFiles - Picture upload of:", Foundry.ObsidianPictureCollection);
		// Need to refetch the file list in Foundry! Because this could be a new
		// manual import and NOT a batch! So to avoid to overwrite I need an update
		// either at the START or at the END to update the shared information in
		// the static variable!!

		//Set basenames and export base export paths if for any reason none are available
		let foundryDestinationPath = "/";
		let foundryDestinationName = "Unnamed" + Date.now() + ".jpg";

		if (Foundry.ObsidianPictureCollection.length === 0) return;

		while (Foundry.ObsidianPictureCollection.length > 0) {
			// holds all pictures from batch (but not from batch to next batch!!)

			const firstElement = Foundry.ObsidianPictureCollection[0]; //replace following instances with firstElement for readability
			const filePath = Foundry.ObsidianPictureCollection[0]?.ObsidianId;

			//const abstractFile = Foundry.app.vault.getFileByPath(Foundry.ObsidianPictureCollection[0].ObsidianPicturePath);

			const pictureFile = Foundry.ObsidianPictureCollection[0].ObsidianPictureFileObj;
			let binary: ArrayBuffer = new ArrayBuffer(0);
			if (pictureFile instanceof TFile) {
				const file: TFile = pictureFile;
				binary = await Foundry.app.vault.readBinary(file); // read binary file and load it for upload
			} //END of if to make sure a file is read

			//{{baseUrl}}/upload?clientId={{clientId}}&path=/obsidian-files/pictures&filename=test.png&mimeType=image/png

			foundryDestinationPath = Foundry.ObsidianPictureCollection[0].FoundryPictureUploadPath || foundryDestinationPath;
			foundryDestinationName =
				Foundry.ObsidianPictureCollection[0].ObsidianPictureHashName || foundryDestinationName;

			const calltype =
				"/upload?clientId=" +
				Foundry.clientId +
				"&path=" +
				foundryDestinationPath +
				"&filename=" +
				foundryDestinationName +
				"&overwrite=true";

			const url = Foundry.foundryRelayServer + calltype;

			const requestParams: RequestUrlParam = {
				url: url,
				method: "POST",
				headers: {
					"Content-Type": "application/octet-stream",
					"x-api-key": Foundry.foundryApiKey,
				},
				body: binary,
			};

			const fileToCheck = firstElement?.FoundryPictureHashPath ?? ""; // uriencoding should take place allready in property assignment!!!

			//Important! MAKE sure "foundryPictureCollection" !! this is up to date!! needs to be refreshed after each batch run!
			//a manual export is a batch RUN of ONE! == Check this AGAIN! Maybe it was the uri encoding!!

			// foundry REST API returns a partly  or fully  Uri encoded filepath (meaning spacses are %20 and such) - we need to make sure we compare the same things
			const fileExists = Foundry.foundryPictureCollection.filter(
				obj => decodeURIComponent(obj.path) === decodeURIComponent(fileToCheck)
			); // need to also uri decode path because it returns only name uri encoded
			//==> why is no picture found on the second batch run? URI Encoding of fileToCheck!!!

			if (fileExists.length === 0) {
				//means if the filter was not successfull then create a file
				//const response = await requestUrl(requestParams);
				
			let response: any = {}
			try {
				response = await requestUrl(requestParams);
				if (response?.status !== 200) {
					throw new Error(`HTTP error! status: ${response?.status} - Error text: ${response?.text}`);
					}
				} catch (error) {
					console.error("M2F: apiPost_ListOfFiles error: ", error.message);
				}
			debug.log("apiPost_ListOfFiles response data: ",response ?? "No data could be retrieved")
			
				//show notification about upload result
				const resultStatus = response?.json?.success ? "(Success)" : "(Failed)";
				const responseMessage =
					Foundry.ObsidianPictureCollection[0].ObsidianPictureName +					
					"==>" +
					response?.json?.path +
					" " +
					resultStatus
					;

				showBrowserNotification("File upload", { body: responseMessage });
			}

			//remove allready uploaded connsumed pictures
			const nameToRemove = firstElement.FoundryPictureHashPath;
			//Remove all objects with the same hashpath
			Foundry.ObsidianPictureCollection = Foundry.ObsidianPictureCollection.filter(
				obj => obj.FoundryPictureHashPath !== nameToRemove
			);
		}
	}

	//== picure Upload List Funktion
	// function to build a list of all embedded pictures in a note
	// with their hash and other information needed for upload
	// pictureSavePath is the path in foundry where the pictures should be saved
	// e.g. /obsidian-files/pictures
	// returns a list of ObsidianPicture objects
	
	//BUT IT NEEDS TO BUILD THE PICTURE LIST OUT OF THE NOTE HTML and NOT the EMBEDS
	//because the embeds do not contain all pictures if they are only linked and not embedded
	//so we need to parse the HTML for <img> tags and get the src attribute
	//REWORK: use a DOM parser to extract <img> tags from the note HTML
	//TODO: Check if all informations will be available if the picture is only linked and not embedded

	//OBSERVATION:
	//1) The ALT tag holds the image name and sometimtes the path - if it is an internal link it is relative to the vault root
	// attention! the alt tag can also be empty or contain a description of the image!!
	//1.1) We drop any image name which do not match a defined image extension and return no picture object
	//1.2) We drop any image name which is a URL (starts with http or https)
	//2) The SRC tag holds the path to the image - if it is an internal link it is relative to the vault root
	// so a regex will match at least the vault base path we can get the vault base path from the adapter
	//2.1) We drop any image which is a URL (starts with http or https)
	//2.2) We drop any image which does not match a defined image extension
	//3) First step we extract the file name from the alt tag and remove any file path
	//4) We match the regex part which matches the vault base path and the file name
	//5) We get the TFile object from the matched path
	//6) We read the binary data from the TFile object
	//7) We create a hash from the binary data
	//8) We build the ObsidianPicture object and add it to the list

						// File path within the vault
						//const filePath = normalizePath(fileName);
						// Check if file exists
						//const existingFile = this.app.vault.getAbstractFileByPath(filePath);
						//getAbstractFileByPath was removed in Obsidian v1.8.10
						//Instead use getFileByPath andgetFolderByPath`
						//const existingFile = this.app.vault.getFileByPath(filePath);
/*
import { TFile, normalizePath } from 'obsidian';

function getTFileByVaultPath(app: App, vaultPath: string): TFile | null {
  const path = normalizePath(vaultPath);
  const af = app.vault.getAbstractFileByPath(path);
  return af instanceof TFile ? af : null;
}
*/
static async buildPictureUploadList(nodeHtml:HTMLElement,app: App, noteFile: TFile, pictureSavePath: string): Promise<ObsidianPicture[]> {
	debug.log("buildPictureUploadList function started");
	const pictureList: ObsidianPicture[] = [];
	const imageExtensions = ["jpg", "jpeg", "gif", "bmp", "png", "svg", "webp"]; //".png",
	const bigIntNumber = BigInt(987654321);
	if (!noteFile || !nodeHtml) return pictureList ?? [];
	//Collect alls Links which are found in the html node list
	//Collect all <img> tags which do NOT start with http or https
	// then get the src attribute and use it to find the TFile object in the vault
	// then read the binary data from the TFile object
	// then create a hash from the binary data
	// then build the ObsidianPicture object and add it to the list
	
	//const imageLinkList = nodeHtml.querySelectorAll('img:not([src^="http"], [src^="https"], [src^="data:"], [src^="blob:"])') as NodeListOf<HTMLImageElement>; //List of relevant tags
	
	const imageLinkList = nodeHtml.querySelectorAll('img[src^="app://"], img:not([src*=":"])') as NodeListOf<HTMLImageElement> //or selecctor if app:// or no : at all
	debug.log("Found the following imageLinkList:", imageLinkList);
	if (imageLinkList.length === 0) return pictureList ?? []; //return if no images found

	const adapter = app.vault.adapter;
	let obsidianNoteBasePath = "";
	let obsidianNoteFilePath = "";
	let obsidianNoteAbsolutePath = "";
	let obsidianPictureAbsolutePath = "";
		
	//TODO:We know we have a FileSystemAdapter - but only on Desktop - on mobile it is different!
	//So we need to check if the adapter is of type FileSystemAdapter
	//If it is not we cannot get the base path and file path - so we cannot proceed
	//If we have a mobile adapter we need to use vault.getResourcePath(myFile) to get the absolute path

	//We also know we have a note so we also know we have a file path
	//We need the base path to get the relativepath from the src attribute
	//Also the image src is relative to the vault base path
	
	//Let us fill the note file information as we allready have them
	if (adapter instanceof FileSystemAdapter) {
		obsidianNoteBasePath = adapter?.getBasePath() ?? "";
		obsidianNoteFilePath = adapter?.getFilePath(noteFile.path) ?? "";
		obsidianNoteAbsolutePath = adapter?.getFullPath(noteFile.path) ?? "";
		}

	// absolutePath is the full system path, e.g., "C:/Users/YourName/ObsidianVault/folder/note.md"
	// for mobile devices use const absolutePath = vault.getResourcePath(myFile); in that case adaper is not of type FileSystemAdapter
	
	//Let us build the information from the list of links we have collected
	for (let i = 0; i < imageLinkList.length; i++) {
		const imageNode = imageLinkList[i];
		const imgSrc = imageNode?.src ?? "";
		//const imgAlt = imageNode?.alt ?? ""; //probably not needed anymore but can give the title of the picture
		if (!imgSrc) continue;	//skip if no src exists
		if (imgSrc.startsWith("http") || imgSrc.startsWith("https")) continue; //skip if src is a URL - but this should be already filtered by the selector

//FIXME: The Regex needs to be smarter to fetch everything between base path and last questionmark. Linux allows for questionmarks in filenames and maybe also in paths
// Remove the app protocol and query parameters
const cleanPath = imgSrc.split('?')[0].replace(/^app:\/\/[0-9a-f]+/, '');
debug.log('Cleaned picture path:', cleanPath);

//TODO: Check if only URI paths can and should be used (for mobile and in general for special characters?)
//The html has an uri path so we need to return in to a non uri
const cleanedUriPath = decodeURIComponent(cleanPath);
debug.log('Decoded URI path:', cleanedUriPath);

// Normalize the path - makes sure to remove redundant slashes and backslashes
const normalizedPicturedPath = normalizePath(cleanedUriPath);
debug.log('Normalized picture path:', normalizedPicturedPath);


// Normalize the obsidianNoteBasePath - makes sure to remove redundant slashes and backslashes
const normalizedBasePath = normalizePath(obsidianNoteBasePath);
debug.log('Normalized base path:', normalizedBasePath);

//Split off the base path part of the full picture link and if base parts are "identical"
// derive the relative path
const splitOffBasePathForCheck=normalizedPicturedPath.slice(0,normalizedBasePath.length)
debug.log("SplitOffPart",splitOffBasePathForCheck)
let constructRelativePath=""
if (splitOffBasePathForCheck.toLocaleLowerCase()===normalizedBasePath.toLocaleLowerCase()){
constructRelativePath = normalizedPicturedPath.slice(normalizedBasePath.length,normalizedPicturedPath.length)
} else {
	new Notice(`Base path mismatch! Relative vault path to picure ${imgSrc} could not be retrieved. Vault base path is ${normalizedBasePath}`, 5000); // 5000 ms = 5 seconds duration
	debug.log(`Base path mismatch! Relative vault path to picure ${imgSrc} could not be retrieved. Vault base path is ${normalizedBasePath}`);
}
// Extract relative path with a regex
//const relativePath = cleanedUriPath.replace(normalizedBasePath, '').replace(/^[\\/]/, '');
debug.log('Relative picture path:', constructRelativePath);

// Get TFile object
const noteFilePath = noteFile?.path ?? "";
//const pictureFile = this.app.metadataCache.getFirstLinkpathDest(
//	relativePath,noteFilePath,
//	);
const pictureFile = this.app.metadataCache.getFirstLinkpathDest(
	constructRelativePath,noteFilePath,
	);
if (!pictureFile) {
	debug.log('No TFile found for path:', constructRelativePath);
	continue; //skip if no pictureFile found
}
debug.log('Extracted pictureFile path:', constructRelativePath);
debug.log('Picture TFile object:', pictureFile);
debug.log('Picture file extension:', pictureFile?.extension);

// Check if the pictureFile has a valid image extension
const fileExtension = imageExtensions.find(ext => pictureFile?.extension.toLowerCase().endsWith(ext));

if (!fileExtension) {
	console.log('Skipping pictureFile due to invalid extension');
	continue; //skip if no valid pictureFile extension is found
}
if (adapter instanceof FileSystemAdapter) {
		obsidianPictureAbsolutePath = adapter?.getFullPath(pictureFile.path) ?? "";
	}
				const binaryFile = await app.vault.readBinary(pictureFile); // read binary data
				const binaryUint8Array = new Uint8Array(binaryFile);

				const { h32, h32ToString, h32Raw, create32, h64, h64ToString, h64Raw, create64 } = await xxhash();

				const pictureHash = h64Raw(binaryUint8Array, bigIntNumber).toString(16).padStart(16, "0");

			const obsidianPicture: ObsidianPicture = {
					ObsidianId: obsidianNoteAbsolutePath,
					ObsidianFilePath: noteFile?.path ?? "",
					ObsidianFileName: noteFile?.name ?? "",
					//ObsidianFileObj:noteFile, //for now only for debug purposes

					ObsidianPictureId: obsidianPictureAbsolutePath,
					ObsidianPicturePath: pictureFile?.path ?? "",
					ObsidianPictureName: pictureFile?.name ?? "",
					ObsidianPictureFileObj: pictureFile, // for now only for debug purposes

					ObsidianPictureExtension: pictureFile?.extension ?? "",
					ObsidianPictureHash: pictureHash,
					ObsidianPictureHashName: pictureFile?.basename + "_" + pictureHash + "." + pictureFile?.extension,
					ObsidianPictureModificationTime: pictureFile?.stat?.mtime ?? 0,
					ObsidianPictureURI: pictureFile.vault.getResourcePath(pictureFile) ?? "",
					FoundryPictureHashPath: pictureSavePath + "/" + pictureFile?.basename + "_" + pictureHash + "." + pictureFile?.extension,
					FoundryPictureUploadPath: pictureSavePath,
				};
				pictureList.push(obsidianPicture);				
}
	return pictureList ?? [];
}

/*
static async buildPictureUploadList_depracated(app: App, noteFile: TFile, pictureSavePath: string): Promise<ObsidianPicture[]> {
		const pictureList: ObsidianPicture[] = [];
		const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"];
		const bigIntNumber = BigInt(987654321);

		if (!noteFile) return pictureList ?? [];

		const cache = app.metadataCache.getFileCache(noteFile);

		if (!cache?.embeds) return pictureList ?? [];

		for (const embed of cache.embeds) {
			const filePath = noteFile?.path ?? "";
			debug.log("==Embed to be processed for picture upload:",embed)
			debug.log("==In file:",filePath)

			debug.log("==Embed resolved to file:",embed.link)
			debug.log("== in note:",filePath)
			const embeddedFile = app.metadataCache.getFirstLinkpathDest(embed.link, filePath); //Internal wikiling = embed.link AND the File the embed is in
			
			debug.log("==Embedded file found:",embeddedFile)
			if (!embeddedFile?.extension) return pictureList ?? [];

			if (imageExtensions.indexOf("." + embeddedFile?.extension) !== -1) {
				const binaryFile = await app.vault.readBinary(embeddedFile); // read binary data
				const binaryUint8Array = new Uint8Array(binaryFile);

				const { h32, h32ToString, h32Raw, create32, h64, h64ToString, h64Raw, create64 } = await xxhash();

				const pictureHash = h64Raw(binaryUint8Array, bigIntNumber).toString(16).padStart(16, "0");
				// encode binary data with bigint seed to bigint and then to string number with radix 16 which is the base of the numbersystem then show it as hex number of allways 16 digits
				// let pictureHash = create64().update(binaryUint8Array).digest() // this should also work if one splits the array
				// https://github.com/jungomi/xxhash-wasm

				
						//let FrontMatterPicturePath = "";
						//if (Foundry.settings.isFoundrySettings){
							// 'file' is a TFile object representing the note
						//	await Foundry.app.fileManager.processFrontMatter(noteFile, (frontmatter) => {                               
						//		FrontMatterPicturePath  = frontmatter['FoundryPicturePath'] ?? (Foundry.settings.foundryPicturePath || "//assets/pictures");
						//		});
						//	}  
				const adapter = app.vault.adapter;
				let obsidianNoteBasePath = "";
				let obsidianNoteFilePath = "";
				let obsidianNoteAbsolutePath = "";

				let obsidianPictureAbsolutePath = "";
				if (adapter instanceof FileSystemAdapter) {
					obsidianNoteBasePath = adapter?.getBasePath() ?? "";
					obsidianNoteFilePath = adapter?.getFilePath(noteFile.path) ?? "";
					obsidianNoteAbsolutePath = adapter?.getFullPath(noteFile.path) ?? "";

					obsidianPictureAbsolutePath = adapter?.getFullPath(embeddedFile.path) ?? "";
					//obsidinPictureRelativePath = adapter.getBasePath
					// absolutePath is the full system path, e.g., "C:/Users/YourName/ObsidianVault/folder/note.md"
					// for mobile devices use const absolutePath = vault.getResourcePath(myFile); in that case adaper is not of type FileSystemAdapter
				}

				const obsidianPicture: ObsidianPicture = {
					ObsidianId: obsidianNoteAbsolutePath,
					ObsidianFilePath: noteFile?.path ?? "",
					ObsidianFileName: noteFile?.name ?? "",
					//ObsidianFileObj:noteFile, //for now only for debug purposes

					ObsidianPictureId: obsidianPictureAbsolutePath,
					ObsidianPicturePath: embeddedFile?.path ?? "",
					ObsidianPictureName: embeddedFile?.name ?? "",
					ObsidianPictureFileObj: embeddedFile, // for now only for debug purposes

					ObsidianPictureExtension: embeddedFile?.extension ?? "",
					ObsidianPictureHash: pictureHash,
					ObsidianPictureHashName: embeddedFile?.basename + "_" + pictureHash + "." + embeddedFile?.extension,
					ObsidianPictureModificationTime: embeddedFile?.stat?.mtime ?? 0,
					ObsidianPictureURI: embeddedFile.vault.getResourcePath(embeddedFile) ?? "",
					FoundryPictureHashPath:
						pictureSavePath + "/" + embeddedFile?.basename + "_" + pictureHash + "." + embeddedFile?.extension,

					FoundryPictureUploadPath: pictureSavePath,
				};

				pictureList.push(obsidianPicture);
			}
		}
		return pictureList ?? [];
	}*/

	// function to build a set out of all frontmatter UUIDs in Obsidian
	static fetchFrontmatterUUIDs(app: App): Map<string, string> {
		// Helper to wait until the metadata cache is resolved and ready to use
		const files = app.vault.getMarkdownFiles();
		// Now proceed to gather UUIDs from frontmatter
		const uuids = new Map();
		for (const file of files) {
			const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
			if (frontmatter?.UUID && typeof frontmatter.UUID === "string") {
				uuids.set(frontmatter.UUID, file.path ?? ""); // Add the UUID to the set
			}
		}
		return uuids;
	}
} //Class End

export const LINK_UPDATE_CODE = 
`
/**
 * Resolves Obsidian-style links within Foundry Journal entries by mapping Obsidian UUIDs/paths
 * to Foundry UUIDs, then detecting and updating unresolved links within journal pages.
 * @async
 * @function
 * @returns {Promise<void>}
 */
async function resolveObsidianLinksInFoundry() {
    // Get all Journal entries in Foundry.
    const allJournals = game.journal.contents;

    // === Step 1: Build Mapping Maps ===

    /** @type {Map<string, string>} Maps Obsidian UUIDs to Foundry page UUIDs */
    const obsidianUUIDtoFoundryId = new Map();
    /** @type {Map<string, string>} Maps Obsidian file paths to Foundry page UUIDs */
    const obsidianPathtoFoundryId = new Map();
    /** @type {Map<string, Object>} Tracks pages with unresolved links */
    const pageListToResolve = new Map();

    // Traverse all journals and their pages to construct lookup maps and page lists.
    for (const journal of allJournals) {
        const journalId = journal.id;

        // Access raw source pages inside each journal
        for (const pageSource of journal._source.pages) {
            const pageId = pageSource._id;
            const flags = pageSource.flags?.markdowntofoundry ?? null;
            // Skip pages without markdowntofoundry flags
            if (!flags) continue;

            // Generate Foundry page UUID
            const foundryPageUuid = \`JournalEntry.\${journalId}.JournalEntryPage.\${pageId}\`;

            // Map Obsidian UUID to Foundry page UUID
            if (flags.uuid) {
                obsidianUUIDtoFoundryId.set(flags.uuid, foundryPageUuid);
            }
            // Map Obsidian path to Foundry page UUID
            if (flags.filePath) {
                obsidianPathtoFoundryId.set(flags.filePath, foundryPageUuid);
            }

            // Record pages that have unresolved links
            if (flags.unresolvedLinks > 0) {
                pageListToResolve.set(foundryPageUuid, {
                    journalId,
                    pageId,
                    pageName: pageSource.name || journal.name,
                    flags,
                    foundryPageUuid
                });
            }
        }
    }

    // === Step 2: Process Each Page with Unresolved Links ===
    for (const [foundryPageUuid, pageData] of pageListToResolve) {
        const { journalId, pageId, pageName, flags } = pageData;
        const pageFlags = flags; // alias for clarity

        // Retrieve JournalEntry document by ID
        const journal = game.journal.get(journalId);
        if (!journal) {
            // Warn if journal is missing and skip
            console.warn(\`❌ Journal not found: \${journalId}\`);
            continue;
        }

        // Retrieve JournalEntryPage document by page ID
        const page = journal.pages.get(pageId);
        if (!page) {
            // Warn if page is missing and skip
            console.warn(\`❌ Page not found: \${pageId} in journal \${journalId}\`);
            continue;
        }

        let content = page.text.content;       // Current HTML content of the page
        let updatedContent = content;           // Will store the modified content

        // Handle every unresolved link in this page's flags
        for (const link of pageFlags.journalLinks) {
            // Skip links that are already resolved - not working yet because update of flags during import
			//FIXME: Find out why flags are not correctly updated
            //if (link.linkResolved) continue;

            let targetUuid = null;          // Foundry target UUID to replace with

            // === Step 1: Resolve Target Foundry UUID ===
            if (link.linkDestinationUUID && obsidianUUIDtoFoundryId.has(link.linkDestinationUUID)) {
                targetUuid = obsidianUUIDtoFoundryId.get(link.linkDestinationUUID);
            } else if (link.linkPath && obsidianPathtoFoundryId.has(link.linkPath)) {
                targetUuid = obsidianPathtoFoundryId.get(link.linkPath);
            } else if (link.linkDestinationUUID === "" && link.linkPath === "" && link.ankerLink) {
                // Self-link if both are empty but ankerLink is provided
                targetUuid = foundryPageUuid;
            } else {
                // Warn and skip if target UUID cannot be resolved
                console.warn(\`❌ Could not resolve target for link:\`, link.linkText, link.linkPath || link.linkDestinationUUID);
                continue;
            }

            // === Step 2: Handle Anchor (Heading) Links ===
            let anchorPart = "";
            if (link.isAnkerLink && link.ankerLink) {
                // Split the anchor by hash and slugify the last fragment
                const hashFragments = link.ankerLink.split("#");
                const lastFragment = hashFragments[hashFragments.length - 1];

                // Slugify: lower case, replace spaces with hyphens, trim hyphens
                const slug = lastFragment
                    .toLowerCase()
                    .replace(/ /g, "-")
                    .replace(/^-+|-+$/g, "");

                if (slug) {
                    anchorPart = \`#\${slug}\`;
                }
            }

            // === Step 3: Build Replacement String ===
            const linkText = link.linkText;
            const replacement = \`@UUID[\${targetUuid}\${anchorPart}]{\${linkText}}\`;

            // === Step 4: Find and Replace Original HTML Link ===
            let oldHtml = null;

            // Case 1: Inline anchor only
            if (link.linkDestinationUUID === "" && link.linkPath === "" && link.ankerLink) {
                const escapedLinkPath = escapeRegExp(link.ankerLink);
                oldHtml = \`<a[^>]*href=["']\${escapedLinkPath}["'][^>]*>.*?<\\/a>\`;
            // Case 2: External .md file without anchor
            } else if (link.linkPath && !link.isAnkerLink) {
                const escapedLinkPath = escapeRegExp(link.linkPath);
                oldHtml = \`<a[^>]*href=["']\${escapedLinkPath}["'][^>]*>.*?<\\/a>\`;
            // Case 3: .md file with anchor
            } else if (link.linkPath && link.isAnkerLink) {
                const escapedLinkPath = escapeRegExp(link.linkPath + link.ankerLink);
                oldHtml = \`<a[^>]*href=["']\${escapedLinkPath}["'][^>]*>.*?<\\/a>\`;
            } else {
                // Fallback for other link types; nothing to set
                console.warn(\`❌ Could not match Link:\`, link, \`in page \${pageId} in journal \${journalId}\`);
            }

            // Perform the regex replacement in HTML, if applicable
            if (oldHtml) {
                const regex = new RegExp(oldHtml, "gm");
                updatedContent = updatedContent.replace(regex, replacement);
                // Mark the link as resolved successfully
                //link.linkResolved = true;
            }
        }

        // === Step 5: Update unresolvedLinks count ===
        pageFlags.unresolvedLinks = pageFlags.journalLinks.filter(l => !l.linkResolved).length;

        // === Step 6: Prepare and perform page update if needed ===
        const updates = {};

        // Update page content if changed
        if (updatedContent !== content) {
            updates["text.content"] = updatedContent;
        }

        // Always update flags to reflect resolved links and unresolved count
        updates["flags.markdowntofoundry"] = pageFlags;

        // Only update if there's something to change
        if (Object.keys(updates).length > 0) {
            await page.update(updates,{ render: true });
            console.log(\`✅ Updated: \${pageName}\`);
        } else {
            console.log(\`⏭️ No changes needed: \${pageName}\`);
        }
    }
    // 👇 Force UI refresh if journals with modified pages are open, done in update allready?
	// Extra safety: re-render open sheets 
    if (journal.sheet?.rendered) { 
        journal.sheet.render(); // Ensure UI refresh 
        }
    console.log("🎉 All unresolved links processed.");
}

/**
 * Escapes special characters for use in regular expressions.
 * @param {string} str - The input string to escape.
 * @returns {string} Escaped string.
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
}

// Run the macro to resolve Obsidian links in Foundry
await resolveObsidianLinksInFoundry();
`
const MACRO_CREATE_CODE = 
`
async function createMacro(){
// Example SVG content as a string
const svgContent =
\`
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  stroke="white"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
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
\`;

// Convert the SVG string into a Blob and then a File object
const svgBlob = new Blob([svgContent], { type: "image/svg+xml" });
const svgFile = new File([svgBlob], "MarkdownToFoundry-icon.svg", { type: "image/svg+xml" });

// Define the target directory path inside Foundry's public file storage
const targetPath = "";
let macroCode =""

// Upload the file using Foundry's FilePicker.upload method
FilePicker.upload("data", targetPath, svgFile, {overwrite: true})
  .then(response => {
    console.log("SVG file created successfully:", response);

    // The uploaded file's path can be used to set the macro's icon
    const uploadedFilePath = response.path;

    // Now create a macro using this uploaded SVG icon
    macroCode = ${JSON.stringify(LINK_UPDATE_CODE)};

   Macro.create({
      name: "MarkdownToFoundry linking",
      type: "script",
      command: macroCode,
      img: uploadedFilePath,
      ownership: 3
    }).then(macro => {
console.log("Created macro object:", macro);
      ui.notifications.info("Macro "+macro.name+" created with SVG icon.");
      let slot = 0;
      let emptySlotFound = false
      let page = 1
      while (!emptySlotFound &&  page <=5 ) {
        const macrosToTest = game.user.getHotbarMacros(page)
        let macroCount=0
          while (!emptySlotFound && macroCount < 10) {
            if (!macrosToTest[macroCount].macro) {emptySlotFound=true;}
            slot = macrosToTest[macroCount].slot
            macroCount=macroCount+1
          }
          page = page+1
      }
      if (emptySlotFound){
      game.user.assignHotbarMacro(macro, slot);
      ui.notifications.info("Macro "+macro.name+" assigned to hotbar slot "+ slot);
    }
    }).catch(err => {
      ui.notifications.error("Failed to create macro: " + err.message);
    });
  })
  .catch(err => {
    ui.notifications.error("Failed to upload SVG file: " + err.message);
  });
}
return await createMacro()
`

const GET_ALL_JOURNALS_CODE=
`
function walkUpTreeFromId(folders, startId)
{
	const folderMap = new Map();
	for (const folderObj of folders) {
    // create a map with unique key = folderID and the corresponding folder object
	folderMap.set(folderObj.id, folderObj);
	}

	const result = [];
	//get the folder object with it's id
	let current = folderMap.get(startId);
	let child = null;

	if (!current) {
		return result; // startId not found
	}

	// Walk up the tree, collecting folders with their parent and child info
	while (current) {
    const parent = current._source?.folder ? folderMap.get(current._source?.folder) ?? null : null;


    result.push({
      id: current._id,
      name: current.name,
      level: current.depth,

      parentId: parent ? parent._id : "root",
      parentName: parent ? parent.name : "root",
      parentLevel: parent ? parent.depth : 0,

      childId: child ? child._id : "none",
      childName: child ? child.name : "none",
      childLevel: child ? child.depth : -1,
    });

    child = current;
    current = parent;

    if (current && current.depth < 0) {
      break;
    }
  }

  // Reverse the array so it starts with the root-level folder first (lowest level)
  result.reverse();

  // Insert the root object at index 0
  // Child information comes from the first element of reversed array, if any
  const firstChild = result.length > 0 ? result[0] : null;
  const rootObj = {
    id: "root",
    name: "root",
    level: 0,

    parentId: "none",
    parentName: "none",
    parentLevel: -1,

    childId: firstChild ? firstChild.id : "none",
    childName: firstChild ? firstChild.name : "none",
    childLevel: firstChild ? firstChild.level : -1,
  };

  result.unshift(rootObj);

  return result;
}

function AllJournals(){
	const folderList = game.folders.contents
	console.log(folderList)
	const journalList = game.journal?.contents || []
	let allJournals = []

	if (journalList.length>0){
	allJournals = Object.entries(journalList).map(([_, FoundryJournal]) => {
		let folderId = FoundryJournal?._source?.folder ?? "";
		let folderTree =[];
		let fullFolderPath = "";
		let folderName = "";        
		if (folderId){
			let folder = game.folders.get(folderId);
			folderName = folder?.name ?? "root";
			folderTree = walkUpTreeFromId(folderList,folderId)
			fullFolderPath =folderTree[1]?.name ?? folderTree[0]?.name ?? "root"
			for (let i = 2; i < folderTree.length; i++) { 
				fullFolderPath = fullFolderPath+"/"+folderTree[i].name;
			}
		}
		const sourcePages = FoundryJournal._source.pages || []
		let pages = []
		if (sourcePages.length>0){
			pages = Object.entries(sourcePages).map(([_, page]) => {		
				return {
					pageId: page?._id ?? "",
					pageName: page?.name ?? "",
					journalId: FoundryJournal?._id ?? "",
					journalName: FoundryJournal?.name ?? "",
					folderId: folderId || "root",
					folderName: folderName || "root",
					folderTree: folderTree,
					fullFolderPath: fullFolderPath,
					flag: page?.flags ?? {},
					obsidianUUID: page?.flags?.obsidian?.uuid ?? "",
					obsdianLinksRemaining: page?.flags?.obsidian?.fullyLinked ?? -1
			};
		});
	}
	return {
		journalId: FoundryJournal?._id ?? "",
		journalName: FoundryJournal?.name ?? "",
		flags: FoundryJournal?.flags ?? "",
		ownership: FoundryJournal?.ownership ?? "",
		folderId: folderId || "root",
		folderName: folderName || "root",
		folderTree: folderTree,
		fullFolderPath: fullFolderPath,
		pages: pages || []
	};
	});
}
return allJournals ?? []
}
return AllJournals()
`
const GET_ALL_FOLDERS_CODE =
`
// Get all folders
function GetAllFolders(){
	const folderList = game.folders?.contents || []
	const folders = Object.entries(folderList).map(([_, folder]) => {
	const folderTree = walkUpTreeFromId(folderList,folder.id)

	let fullFolderPath = folderTree[1].name ?? folderTree[0].name ?? "root"
	for (let i = 2; i < folderTree.length; i++) { 
		fullFolderPath = fullFolderPath+"/"+folderTree[i].name;
	}

	return {
		id: folder.id,
		name: folder.name,
		type: folder.type,
		parent: folder._source?.folder ?? "root",
		depth: folder.depth,
		path: folder.uuid,
		sorting: folder.sort,
		sortingMode: folder.sortingMode,
		folderTree: folderTree,
		fullFolderPath: fullFolderPath
		};
	});
	return folders ?? [];
}

function walkUpTreeFromId(folders, startId){
	const folderMap = new Map();
	for (const folderObj of folders) {
    // create a map with unique key = folderID and the corresponding folder object
	folderMap.set(folderObj.id, folderObj);
	}

	const result = [];
	//get the folder object with it's id
	let current = folderMap.get(startId);
	let child = null;

	if (!current) {
	return result; // startId not found
	}

	// Walk up the tree, collecting folders with their parent and child info
	while (current) {
		const parent = current._source?.folder ? folderMap.get(current._source?.folder) ?? null : null;

	result.push({
		id: current._id,
		name: current.name,
		level: current.depth,

		parentId: parent ? parent._id : "root",
		parentName: parent ? parent.name : "root",
		parentLevel: parent ? parent.depth : 0,

		childId: child ? child._id : "none",
		childName: child ? child.name : "none",
		childLevel: child ? child.depth : -1,
	});

	child = current;
	current = parent;

	if (current && current.depth < 0) {
		break;
		}
	}

	// Reverse the array so it starts with the root-level folder first (lowest level)
	result.reverse();

  	// Insert the root object at index 0
  	// Child information comes from the first element of reversed array, if any
	const firstChild = result.length > 0 ? result[0] : null;
	const rootObj = {
		id: "root",
		name: "root",
		level: 0,

		parentId: "none",
		parentName: "none",
		parentLevel: -1,

		childId: firstChild ? firstChild.id : "none",
		childName: firstChild ? firstChild.name : "none",
		childLevel: firstChild ? firstChild.level : -1,
	};

	result.unshift(rootObj);
	return result;
}
return GetAllFolders()
`;

