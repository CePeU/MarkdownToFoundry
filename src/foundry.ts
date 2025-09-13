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
	FileSystemAdapter,
	Notice,
} from "obsidian";
import { showBrowserNotification, ObsidianPicture } from "src/utils";


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
	console.debug(" M2F:apiPost_CreateFoundryMacro function was started")
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
			console.debug(" M2F:apiPost_CreateFoundryMacro response data: ",response ?? "No data could be retrieved")
			
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
			console.debug("M2F: apiPost_CreateLinking response data: ",response ?? "No data could be retrieved")
			
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
		console.debug("M2F: Create or Update Pages function started")
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
					console.debug(`Destination Journal was not found a new one names ${this.noteJournalDestinationName} will be created`)
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
			console.debug("M2F: A page update is necessary")
			this.notePageId = await this.apiPut_CreatePage(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer)
			updateFrontmatter = false
			//the assignment should not be necessary as this is an update and the id shoul be existent
			// Update Page
		}

		if (todo.createPage) {
			console.debug("A page create is necessary")
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
			console.debug("M2F: Linking run started")
			await this.apiPost_CreateLinking(Foundry.foundryApiKey, Foundry.clientId, Foundry.foundryRelayServer)
		}
	}

	static async initFoundryPageObject(app: App, foundryHtml: FoundryHtml): Promise<Foundry> {
		const frontmatterInfo = await Foundry.readFrontmatter(app, foundryHtml.obsidianFileObj);
		return new Foundry(app, foundryHtml, frontmatterInfo);
	}

	static async readFrontmatter(app: App, file: TFile): Promise<ObsdianFrontmatterInfo> {
		console.debug("M2F: Frontmatter read started - working on file:", file.path)
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
		console.debug("M2F: INIT for Foundry export was executed")
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
					console.debug("M2F: apiPost_startHeadlessSession/handshake error: ", error.message);
				}
			console.debug("M2F: apiPost_startHeadlessSession/handshake response data: ",response ?? "No data could be retrieved")

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
			console.debug("M2F: apiPost_startHeadlessSession/session response data: ",response ?? "No data could be retrieved")
			
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
		console.debug("M2F: apiDelete_endHeadlessSession response data: ",response ?? "No data could be retrieved")		
		
	} catch (error) {
			console.error('Error:', error.response?.json || error.message);
			throw new Error("There was a Problem with ending your Session");

		}

		return response ?? ""
	} // End of session function

	static async apiGet_APIStatus(relayServer: string, apiKey: string): Promise<boolean> {
		console.debug("M2F: apiGet_APIStatus function started")
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
		console.debug("M2F: apiGet_APIStatus response data: ",response ?? "No data could be retrieved")


		if (response?.json?.status === "ok") {
			apiRunning = true;
		}
		return apiRunning;
	}

	static async apiGet_ClientId(relayServer: string, apiKey: string): Promise<string> {
		console.debug("M2F: apiGet_ClientId function entered")
		
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
		console.debug("M2F: apiGet_ClientId response data: ",response ?? "No data could be retrieved")
		

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
		console.debug("Returned a LIST of connected clients: apiGet_FoundryClientList")
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
		console.debug("M2F: apiGet_FoundryClientList retrieved: ", response ?? "Data could not be retrieved")
		
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
			console.debug("M2F: apiGet_AllPictureFilePaths response data: ",response ?? "No data could be retrieved")
			
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
		console.debug("M2F: writeFrontmatter is beeing executed")
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
		console.debug("M2F: apiGet_AllFolders got executed")
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
			console.debug("M2F: apiGet_AllFolders response data: ",response ?? "No data could be retrieved")
			
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
		console.debug("M2F: apiGet_AllJournals function entered")
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
			console.debug("M2F: apiGet_AllJournals response data: ",response ?? "No data could be retrieved")
			
		journalList = response?.json?.result ?? [];
		return journalList
	}

	async apiPost_CreateFolder(apiKey: string, clientId: string, relayServer: string, folderName: string, parentFolderId: string): Promise<string> {
		console.debug("M2F: apiPost_CreateFolder function started")
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
			console.debug("M2F: apiPost_CreateFolder response data: ",response ?? "No data could be retrieved")
			
		const folderId = response?.json?.result?._id ?? ""
		return folderId
	}


	public async apiPost_CreateJournal(apiKey: string, clientId: string, relayServer: string, journalName: string, folderId: string): Promise<string> {
		console.debug("M2F: apiPost_CreateJournal has started");
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
			console.debug("M2F: apiPost_CreateJournal response data: ",response ?? "No data could be retrieved")
			
		const journalId = response?.json?.uuid ?? "";
		//The API returns JournalEntry.xxxIDxxx we need want to keept it consistent
		const parts = journalId.split('.');             // split by dot
		const returnJustTheId = parts[parts.length - 1];
		return returnJustTheId
	}

	public async apiPut_CreatePage(apiKey: string, clientId: string, relayServer: string): Promise<string> {
		console.debug("M2F: apiPut_CreatePage got executed")
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
			console.log("Page create in progress", this.noteHtml);
			updatePage = {
				"pages": [
					{
						"name": this.notePageTitle,
						"type": "text",
						"text": {
							content:TEST_HTML, //this.noteHtml,
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
			console.log("Page update in progress")
			console.log("HTML",this.noteHtml)
			console.log("TEST HTML",TEST_HTML)
			//const encoder = new TextEncoder();
			//const utf8Bytes = encoder.encode(this.noteHtml);
			let TEST_HTML2 = this.noteHtml //"<p>kljljljkkjhkjhhgjhgjhgfgfhgfhgfhgfhgfhgf</p>"
			console.log("HTML BYTES",TEST_HTML2)
			// updates the page according to the page id
			updatePage = {
				pages: [
					{
						name: this.notePageTitle,
						type: "text",
						text: {
							content: TEST_HTML2,
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
		const encoder = new TextEncoder();
		const utf8Bytes = encoder.encode(newbody);

		// Convert to ArrayBuffer if needed (this is already an ArrayBuffer-like Uint8Array)
const arrayBuffer = utf8Bytes.buffer.slice(utf8Bytes.byteOffset, utf8Bytes.byteOffset + utf8Bytes.byteLength);


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
			console.debug("M2F: apiPut_CreatePage response data: ",response ?? "No data could be retrieved")
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

		public async apiPut_CreatePage_Test(apiKey: string, clientId: string, relayServer: string): Promise<string> {
		console.debug("M2F: apiPut_CreatePage got executed")
		let returnPageId = ""
		//{{baseUrl}}/update?clientId={{clientId}}&uuid=JournalEntry.SZ4OjfnRipsVMbvX
		if (!this.noteJournalDestinationId) {
			throw new Error("NO journal found JOURNAL ID EMPTY");
		}

		const calltype = "/execute-js?clientId=" + clientId; //executes a script!
		const url = relayServer + calltype;

		//const calltype = "/update?clientId=" + clientId + "&uuid=JournalEntry." + this.noteJournalDestinationId + "&selected=false";
		//const url = relayServer + calltype;

		let updatePage = {};
		if (this.notePageId === undefined || this.notePageId === "") {
			// creates a new page as the page does not exist in the journal
			console.log("Page create in progress", this.noteHtml);
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
			console.log("Page update in progress")
			console.log("HTML",this.noteHtml)
			console.log("TEST HTML",TEST_HTML)
			//const encoder = new TextEncoder();
			//const utf8Bytes = encoder.encode(this.noteHtml);
			let TEST_HTML2 = this.noteHtml //"<p>kljljljkkjhkjhhgjhgjhgfgfhgfhgfhgfhgfhgf</p>"
			console.log("HTML BYTES",TEST_HTML2)
			// updates the page according to the page id
			updatePage = `{
				pages: [
					{
						name: ${this.notePageTitle},
						type: "text",
						text: {
							content: ${this.noteHtml},
							format: 1,
						},
						_id: ${this.notePageId},
						flags: {
							markdowntofoundry: {
								uuid: ${this.noteObsidianUUID},
								vault: "",
								filePath: ${this.noteFilePath},
								noteTitle: ${this.noteTitle},
								noteHash: ${this.noteHash},
								cTime: ${this.noteCtime},
								mTime: ${this.noteMtime},
								uploadTime: ${this.noteUploadTime},
								journalLinks: "",
								unresolvedLinks: ${this.noteUnresolvedLinks}	
							},
						},
						title: {
							show: true,
							level: 1,
						},
						ownership: {
							default: ${this.noteOwnership},
						},
					},
				],
			}`;
		}
	
		console.log("UPDATEPAGE",updatePage)
		const temp = JSON.stringify(updatePage)
		let jscript=
		`
		console.log(\`${updatePage}\`)	
		`
/*
		jscript=
		`
		console.log("This is a test")	
		`
*/
console.log("JSCRIPT",jscript)	
		const scriptObj = { script: jscript };
		const bodyJSON = JSON.stringify(scriptObj);
console.log("BODY",bodyJSON)

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
					console.error("M2F: apiPut_CreatePage error: ", error.message);
				}
			console.debug("M2F: apiPut_CreatePage response data: ",response ?? "No data could be retrieved")
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
			console.debug("M2F: apiPost_ListOfFiles response data: ",response ?? "No data could be retrieved")
			
				const responseMessage =
					Foundry.ObsidianPictureCollection[0].ObsidianPictureName +
					" " +
					response?.json?.message +
					" to " +
					response?.json?.path;

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
	static async buildPictureUploadList(app: App, noteFile: TFile, pictureSavePath: string): Promise<ObsidianPicture[]> {
		const pictureList: ObsidianPicture[] = [];
		const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"];
		const bigIntNumber = BigInt(987654321);

		if (!noteFile) return pictureList ?? [];

		const cache = app.metadataCache.getFileCache(noteFile);

		if (!cache?.embeds) return pictureList ?? [];

		for (const embed of cache.embeds) {
			const filePath = noteFile?.path ?? "";

			const embeddedFile = app.metadataCache.getFirstLinkpathDest(embed.link, filePath); //Internal wikiling = embed.link AND the File the embed is in

			if (!embeddedFile?.extension) return pictureList ?? [];

			if (imageExtensions.indexOf("." + embeddedFile?.extension) !== -1) {
				const binaryFile = await app.vault.readBinary(embeddedFile); // read binary data
				const binaryUint8Array = new Uint8Array(binaryFile);

				const { h32, h32ToString, h32Raw, create32, h64, h64ToString, h64Raw, create64 } = await xxhash();

				const pictureHash = h64Raw(binaryUint8Array, bigIntNumber).toString(16).padStart(16, "0");
				// encode binary data with bigint seed to bigint and then to string number with radix 16 which is the base of the numbersystem then show it as hex number of allways 16 digits
				// let pictureHash = create64().update(binaryUint8Array).digest() // this should also work if one splits the array
				// https://github.com/jungomi/xxhash-wasm

				/*
						let FrontMatterPicturePath = "";
						if (Foundry.settings.isFoundrySettings){
							// 'file' is a TFile object representing the note
							await Foundry.app.fileManager.processFrontMatter(noteFile, (frontmatter) => {                               
								FrontMatterPicturePath  = frontmatter['FoundryPicturePath'] ?? (Foundry.settings.foundryPicturePath || "//assets/pictures");
								});
							}   */
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
	}

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

const LINK_UPDATE_CODE = 
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
  stroke="black"
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

const TEST_HTML =
`
<details  data-callout="example" class="callout"><summary>KI Prompt </summary><div>
<p>Ich benÃ¶tige die Beschreibung von vier LÃ¤den wie sie sich im Mittelalter oder der renesaince dargestellt haben mÃ¶gen die einen edlen mit Kleidung, Schuhen und Waffen ausgestattet haben kÃ¶nnten so dass er zu einem festlichen Empfang geht. Die Beschreibungen der LÃ¤den der Waren und des VerkÃ¤ufers sollen detailliert sein und mindestens 50 SÃ¤tze umfassen.</p>
<p>Bitte erstelle mir eine Liste von 5 Barbieren die in Gareth beheimatet sind inklusive einer Beschreibung ihres Arbeitsplatzes, des Barbiers und seiner angestellten. Stufe die Barbiere ab in Preis und QualitÃ¤t und beachte das es sich um ein mittelalterliches bzw. rokkoko setting handelt. Verwende mindestens 20 SÃ¤tze pro Barbier</p>
<h4 data-heading="ChatGPT">ChatGPT</h4>
<p>Erstelle eine immersive, atmosphÃ¤rische Beschreibung eines Ladens, wie er in einer mittelalterlichen oder frÃ¼hneuzeitlichen (Renaissance-/Rokoko-inspirierten) Stadt wie Gareth aus dem Rollenspielsystem <em>Das Schwarze Auge</em> (DSA5) existieren kÃ¶nnte. Der Laden soll fÃ¼r wohlhabende Kunden (Adlige, Gelehrte, hochgestellte BÃ¼rger) hochwertige Waren anbieten â€“ z.â€¯B. Kleidung, Schuhe, Waffen oder KÃ¶rperpflege.</p>
<p>Die Beschreibung soll mindestens 50 SÃ¤tze umfassen und sowohl den Aufbau und das Innere des Ladens als auch die ausgestellten Waren, GerÃ¼che, LichtverhÃ¤ltnisse und AtmosphÃ¤re beschreiben. ZusÃ¤tzlich sollen der Ladenbesitzer sowie seine Angestellten detailliert dargestellt werden, inklusive ihrer Rolle, PersÃ¶nlichkeit, Kleidung und Ã¤uÃŸeren Erscheinung.</p>
<p>Bitte beachte:</p>
<ul>
<li>Verwende eine bildhafte, lebendige Sprache.</li>
<li>Der Stil soll an literarische Beschreibungen erinnern â€“ wie aus einem atmosphÃ¤rischen Roman.</li>
<li>Die Zeit ist an das spÃ¤te Mittelalter oder Rokoko angelehnt â€“ mit Magie- oder Fantasyelementen, wie sie in DSA5 vorkommen kÃ¶nnen.</li>
<li>Kleidung, Interieur und Umgangsformen sollen der gesellschaftlichen Schicht angepasst sein (von fein bis rustikal).</li>
<li>Achte auf AuthentizitÃ¤t im Stil (z.â€¯B. keine modernen Begriffe oder Technologien).</li>
<li>ErgÃ¤nze fÃ¼r jede Person (Besitzer/in, Angestellte) 3â€“5 zusÃ¤tzliche SÃ¤tze zur Beschreibung ihres Aussehens und ihrer Kleidung.</li>
</ul>
</div><div></div></details>
<code>Erstelle eine stimmungsvolle, detailreiche Beschreibung eines Ladens in einer stÃ¤dtischen Umgebung der _DSA5_-Welt, vorzugsweise in Gareth oder einer Ã¤hnlich groÃŸen Stadt. Der Laden soll hochqualitative Waren fÃ¼r wohlhabende Kundschaft anbieten â€“ etwa Kleidung, Schuhe, Waffen oder KÃ¶rperpflegeartikel â€“, mit besonderem Fokus auf Produkte fÃ¼r festliche AnlÃ¤sse oder reprÃ¤sentative Zwecke. Die Zeit ist an das spÃ¤te Mittelalter bis Rokoko angelehnt, inklusive fantasievoller und magischer Elemente, wie sie im Aventurien-Setting Ã¼blich sind.
Die Beschreibung soll mindestens **50 vollstÃ¤ndige SÃ¤tze** umfassen und folgende Aspekte umfassen:
**1. Die Ã¤uÃŸere Erscheinung des Ladens:**
- GebÃ¤udeart, Standort in der Stadt (z.â€¯B. NÃ¤he zum Markt, Adelsviertel etc.), Schild, Fenster, Geruch und GerÃ¤uschkulisse drauÃŸen.
**2. Das Innere des Ladens:**
- Einrichtung, Materialien, Dekor, Lichtquellen, GerÃ¼che, AtmosphÃ¤re, GerÃ¤usche, eventuell magische Effekte.
- WarenprÃ¤sentation (Schaufenster, Regale, Tische, Vitrinen), Produktauswahl, Preisspanne.
**3. Die Besitzerperson:**
- Name, Alter, Herkunft, Sprechweise, Fachkenntnis, Auftreten gegenÃ¼ber Kunden.
- Beschreibung des Ã¤uÃŸeren Erscheinungsbildes: Kleidung, Schmuck, KÃ¶rperhaltung, Frisur, eventuell Zauberartefakte.
**4. Die Angestellten (mindestens 1â€“2):**
- Aufgaben, Umgang mit Kunden, Hierarchie, besondere Eigenheiten.
- Auch hier: detaillierte Beschreibung von Kleidung, Haar, Gang, Umgangsformen etc.
**5. Preisniveau &amp; QualitÃ¤t:**
- Welches Klientel wird angesprochen (z.â€¯B. Adlige, Magier, wohlhabende HÃ¤ndler)?
- Wie hebt sich der Laden von anderen ab (Handwerkskunst, Herkunft der Waren, exzellenter Service, ExklusivitÃ¤t)?
Stilvorgabe:
- Schreibe literarisch, atmosphÃ¤risch, mit bildhafter Sprache und einem Hauch Poesie.
- Der Text soll beim Lesen die Fantasie anregen und eine Szene lebendig machen, wie sie in einem gut ausgearbeiteten Pen-&amp;-Paper-Abenteuer vorkommen kÃ¶nnte.
- Vermeide moderne Begriffe oder Konzepte. Halte die Sprache dem Setting entsprechend.
</code>
<h2 data-heading="Schneidereien">Schneidereien</h2>
<h3 data-heading="**â€žZum Goldenen Zwirnâ€œ â€“ Ein Gewandhaus fÃ¼r Edelleute**"><strong>â€žZum Goldenen Zwirnâ€œ â€“ Ein Gewandhaus fÃ¼r Edelleute</strong></h3>
<p>In einer gepflegten Seitengasse des gehobenen Viertels von Gareth liegt der ehrwÃ¼rdige Laden â€žZum Goldenen Zwirnâ€œ, ein Refugium fÃ¼r jene, die sich mit Stil, Geschmack und Eleganz zu kleiden wissen. Schon die Schaufenster lassen die edlen Stoffe in tiefem Purpur, kÃ¶nigsblauem Samt und feinem Goldbrokat erkennen, die kunstvoll auf Schneiderpuppen drapiert sind. Der sÃ¼ÃŸe Duft von Lavendel und gepressten RosenblÃ¤ttern liegt in der Luft, gemischt mit der herben Note von Bienenwachs und feinster Seide. Betritt man das Ladeninnere, empfÃ¤ngt einen ein warmes Licht, das von zahlreichen Ã–llampen auf polierte Holzregale, schwere Stoffballen und ziselierte Schneiderwerkzeuge fÃ¤llt.</p>
<p>Der Besitzer des Ladens, <strong>Meister Albrecht von Seidenstich</strong>, ist ein Mann, dessen Erscheinung fast selbst ein Kunstwerk ist. GroÃŸ gewachsen und von schlanker Statur, trÃ¤gt er sein schlohweiÃŸes Haar stets zu einem eleganten Knoten gebunden. Sein Gesicht ist markant, mit hohen Wangenknochen und einem ruhigen, prÃ¼fenden Blick, der Stoffe mit derselben PrÃ¤zision betrachtet wie die Haltung eines Kunden. Ein edelblauer Samtwams mit goldenen KnÃ¶pfen liegt makellos Ã¼ber seinem schmalen OberkÃ¶rper, ergÃ¤nzt durch einen silbernen Gehrock mit Brokatmuster. Auf seiner Brust prangt eine goldene Brosche in Form einer Schere â€“ das Familienzeichen der Seidenstichs. Stets mit weiÃŸen Spitzenhandschuhen bekleidet, berÃ¼hrt er Stoff nur mit Andacht und Sorgfalt, als wÃ¤ren sie heilige Reliquien.</p>
<p>UnterstÃ¼tzt wird er von zwei jungen Gesellen: <strong>Leontin</strong> und <strong>Iselda</strong>. Leontin, ein aufgeweckter junger Mann mit zerzaustem braunem Haar, arbeitet flink und zielstrebig, seine Finger fast stÃ¤ndig mit Nadel und Faden beschÃ¤ftigt. Er trÃ¤gt ein hellgraues Arbeitskittelgewand, das schlicht, aber tadellos sauber ist. Iselda hingegen, eine elegante junge Frau mit in einer geflochtenen Krone gestecktem blondem Haar, bewegt sich mit fast tÃ¤nzerischer Anmut durch das Atelier. Sie trÃ¤gt ein bodenlanges Leinenkleid mit einem gestreiften Halbschurz, auf dem stets eine Stecknadel oder ein MaÃŸband bereitliegt. Ihre Kleidung ist schlicht, aber stilvoll â€“ ein Zeichen, dass sie weiÃŸ, was SchÃ¶nheit ist, ohne prunkvoll zu wirken.</p>
<p>â€žZum Goldenen Zwirnâ€œ ist nicht nur ein Ort, an dem Kleidung gefertigt wird â€“ es ist ein Tempel der Eleganz, in dem aus Garn und Stoff Geschichten gewoben werden. Jeder Kunde, der hier eintritt, wird nicht nur mit Kleidung bedacht, sondern mit einer IdentitÃ¤t â€“ maÃŸgeschneidert bis ins letzte Detail.</p>
<h3 data-heading="&quot;Zum Kaiserlichen Gewand&quot; - Hochwertige Schneiderei">"Zum Kaiserlichen Gewand" - Hochwertige Schneiderei</h3>
<p>In einer der vornehmsten StraÃŸen Gareths, unweit des Praios-Tempels, befindet sich die renommierte Schneiderei "Zum Kaiserlichen Gewand". Das imposante Fachwerkhaus mit seinen kunstvoll geschnitzten Holzornamenten und groÃŸen Schaufenstern zieht sofort die Blicke auf sich. Meister Aldrich von Gareth, ein distinguierter Herr mit silbernem Haar und scharfem Blick, leitet dieses Etablissement seit Ã¼ber drei Jahrzehnten.</p>
<p>Die Besonderheit des "Kaiserlichen Gewands" liegt in der Verwendung Ã¤uÃŸerst seltener und exquisiter Stoffe, die Aldrich durch ein Netzwerk von HÃ¤ndlern aus allen Teilen Aventuriens bezieht. Seine Beziehungen reichen bis in den Hof des Mittelreiches, was ihm Zugang zu Materialien verschafft, die anderen Schneidern verwehrt bleiben.</p>
<p>Beim Betreten des Ladens wird der edle Kunde von einem Duft aus feinstem Bienenwachs und edlen HÃ¶lzern empfangen. Die WÃ¤nde sind mit Stoffbahnen in satten Farben behangen - scharlachrotes Tuch aus Al'Anfa, azurblaue Seide aus Khunchom und golddurchwirkter Brokat aus Fasar. In einer Ecke arbeiten Gesellen eifrig an NÃ¤hten und Stickereien, wÃ¤hrend auf einem massiven Eichentisch MusterbÃ¼cher mit den neuesten ModeentwÃ¼rfen aus Vinsalt und Punin ausliegen.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Aldrich ein Ensemble aus schwerem, burgunderrotem Samt, der so dicht gewebt ist, dass er im Licht wie flÃ¼ssiges Metall schimmert. Das Wams wird mit handgefertigten KnÃ¶pfen aus poliertem Bernstein versehen, wÃ¤hrend die Beinlinge aus feinstem, butterweichem Leder gefertigt sind. Ein Umhang aus nachtblauem Tuch, gefÃ¼ttert mit silbergrauem Seidendamast, rundet das Outfit ab.</p>
<p>Die Anprobe gleicht einem Ritual, bei dem Aldrich persÃ¶nlich jeden Zentimeter des Stoffes prÃ¼ft und anpasst. Er erklÃ¤rt seinem edlen Kunden die Herkunft und Besonderheiten jedes Materials, von der Zucht der Seidenraupen bis zur komplexen Webtechnik des Damastes. Aldrich betont, wie die sorgfÃ¤ltige Auswahl der Stoffe und Schnitte die natÃ¼rliche Ausstrahlung und den Stand des TrÃ¤gers unterstreichen.</p>
<p>Als besonderes Detail schlÃ¤gt Aldrich vor, das Wappen des Adelshauses subtil in das Muster des Ã„rmelsaums einzuarbeiten - ein Zeichen von Stolz und ZugehÃ¶rigkeit, das nur den aufmerksamsten Beobachtern auffallen wird. Die Fertigstellung eines solchen Meisterwerks nimmt mehrere Wochen in Anspruch, aber Aldrich garantiert, dass das Ergebnis jeden Preis und jede Wartezeit wert sein wird.</p>
<h3 data-heading="&quot;Seidenfaden &amp; Nadelkunst&quot; - Exquisite Stickerei">"Seidenfaden &amp; Nadelkunst" - Exquisite Stickerei</h3>
<p>In einer ruhigen SeitenstraÃŸe des HÃ¤ndlerviertels von Gareth befindet sich "Seidenfaden &amp; Nadelkunst", ein unscheinbares, aber Ã¤uÃŸerst renommiertes Atelier fÃ¼r Stickerei und Verzierungen. Das kleine LadengeschÃ¤ft wird von Meisterin Eleonora Fadenfein gefÃ¼hrt, einer zierlichen Frau mit flinken Fingern und einem Auge fÃ¼r kleinste Details.</p>
<p>Die Einzigartigkeit von "Seidenfaden &amp; Nadelkunst" liegt in Eleonoras auÃŸergewÃ¶hnlicher FÃ¤higkeit, historische Stickereien und Verzierungen zu reproduzieren und zu interpretieren. Ihre Werkstatt beherbergt eine umfangreiche Sammlung von MusterbÃ¼chern und Zeichnungen, die Stickereien aus verschiedenen Epochen und Kulturen Aventuriens dokumentieren.</p>
<p>Der Laden selbst ist ein Paradies fÃ¼r Liebhaber feiner Handarbeit. An den WÃ¤nden hÃ¤ngen Rahmen mit kunstvollen Stickereien, von filigranen Blumenmustern bis hin zu komplexen heraldischen Darstellungen. Glasvitrinen prÃ¤sentieren eine Auswahl an Garnen in hunderten von Farbnuancen, von schimmernder Seide bis zu FÃ¤den, die mit Goldflocken durchzogen sind.</p>
<p>FÃ¼r den festlichen Empfang schlÃ¤gt Eleonora vor, ein bereits vorhandenes edles Gewand durch ihre Kunst aufzuwerten. Sie empfiehlt eine aufwÃ¤ndige Stickerei am Kragen und den Ã„rmelaufschlÃ¤gen, die Szenen aus der Geschichte des Adelshauses darstellt. DafÃ¼r verwendet sie feinste SeidenfÃ¤den in subtil abgestuften FarbtÃ¶nen, ergÃ¤nzt durch echte GoldfÃ¤den fÃ¼r Akzente und Highlights.</p>
<p>Die Planung der Stickerei ist ein kreativer Prozess, bei dem Eleonora eng mit dem Kunden zusammenarbeitet. Sie studiert die Familienchroniken, um bedeutsame Ereignisse und Symbole zu identifizieren, und erstellt detaillierte EntwÃ¼rfe, die sie dem Adligen zur Genehmigung vorlegt. Jeder Stich wird von Eleonora persÃ¶nlich ausgefÃ¼hrt, oft unter Verwendung einer Lupe, um absolute PrÃ¤zision zu gewÃ¤hrleisten.</p>
<p>Eleonora erklÃ¤rt ihrem edlen Kunden die Bedeutung jedes Elements der Stickerei und wie es zur Gesamtkomposition beitrÃ¤gt. Sie betont, wie die feine Handarbeit nicht nur die Kleidung verschÃ¶nert, sondern auch eine Geschichte erzÃ¤hlt und den Status des TrÃ¤gers unterstreicht. Als besonderes Angebot schlÃ¤gt sie vor, einen winzigen GlÃ¼cksbringer - vielleicht das Wappentier der Familie - an einer versteckten Stelle einzusticken, als persÃ¶nlichen Talisman fÃ¼r den TrÃ¤ger.</p>
<h3 data-heading="&quot;Pelzwerk &amp; Federpracht&quot; - Exklusive Accessoires">"Pelzwerk &amp; Federpracht" - Exklusive Accessoires</h3>
<p>Am Prachtboulevard von Gareth, nur einen Steinwurf vom Palast entfernt, befindet sich "Pelzwerk &amp; Federpracht", ein exklusives GeschÃ¤ft fÃ¼r edle Accessoires. Der Laden besticht durch seine opulente Einrichtung mit dunklem Holz, vergoldeten Spiegeln und weichen Teppichen. Meister Konrad Pelzner, ein stattlicher Mann mit gepflegtem Bart und stets tadellos gekleidet, empfÃ¤ngt hier seine illustre Kundschaft.</p>
<p>Die Besonderheit von "Pelzwerk &amp; Federpracht" liegt in Konrads unÃ¼bertroffener Expertise in der Verarbeitung seltenster Pelze und exotischer Federn. Sein GeschÃ¤ft ist die erste Adresse fÃ¼r alle, die ihren GewÃ¤ndern den letzten Schliff verleihen wollen.</p>
<p>Der Laden ist ein Fest fÃ¼r die Sinne. Weiche Pelze in allen erdenklichen Farben und Texturen schmÃ¼cken die WÃ¤nde, von schneeweiÃŸem Polarfuchs bis zu samtschwarzem Nerz. In Glasvitrinen werden kunstvoll arrangierte Federkollektionen prÃ¤sentiert, darunter schillernde Pfauenfedern, majestÃ¤tische Adlerfedern und zarte Reiherfedern.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Konrad einen Umhangkragen aus silbergrauem Zobelpelz, der perfekt mit dem vom Schneider gefertigten Gewand harmoniert. Als ErgÃ¤nzung schlÃ¤gt er Manschetten aus dem gleichen Pelz vor, um ein einheitliches Bild zu schaffen. FÃ¼r einen dramatischen Akzent rÃ¤t er zu einer Brosche mit einer kunstvoll arrangierten Komposition aus Pfauenfedern und Fasanenfedern, die das Licht in schillernden Farben reflektieren.</p>
<p>Die Auswahl der perfekten Accessoires ist ein langwieriger Prozess. Konrad prÃ¤sentiert verschiedene Pelzarten und lÃ¤sst den Kunden ihre Weichheit und WÃ¤rme spÃ¼ren. Er erklÃ¤rt die Herkunft jedes Pelzes und jeder Feder, oft mit Anekdoten Ã¼ber die Jagd oder den Handel, der nÃ¶tig war, um sie zu beschaffen. FÃ¼r die Brosche wÃ¤hlt er jede Feder einzeln aus und arrangiert sie vor den Augen des Kunden, um die perfekte Komposition zu finden.</p>
<p>Konrad betont, wie die richtige Wahl der Accessoires ein Gewand von schÃ¶n zu auÃŸergewÃ¶hnlich machen kann. Er berÃ¤t seinen edlen Kunden auch zur Pflege der Pelze und Federn, damit diese Ã¼ber Generationen hinweg ihre Pracht behalten. Als besonderes Angebot prÃ¤sentiert er eine Sammlung antiker KnÃ¶pfe aus Elfenbein und Perlmutt, die er Ã¼ber Jahre hinweg gesammelt hat und die dem Gewand einen Hauch von Geschichte verleihen wÃ¼rden.</p>
<h3 data-heading="&quot;Zur Goldenen Schere&quot; - Traditionelle Schneiderei">"Zur Goldenen Schere" - Traditionelle Schneiderei</h3>
<p>In einer der Ã¤ltesten Gassen Gareths, umgeben von ehrwÃ¼rdigen FachwerkhÃ¤usern, befindet sich "Zur Goldenen Schere", eine Schneiderei, die seit Generationen im Besitz der Familie Nadelstich ist. Der aktuelle Inhaber, Meister Gottfried Nadelstich, ein freundlicher Mann mittleren Alters mit einer markanten Brille, fÃ¼hrt das GeschÃ¤ft mit Stolz und Hingabe.</p>
<p>Die Einzigartigkeit der "Goldenen Schere" liegt in ihrer Spezialisierung auf traditionelle Schnitt- und NÃ¤htechniken, die in vielen modernen Schneidereien in Vergessenheit geraten sind. Gottfried bewahrt das Wissen und die Fertigkeiten seiner Vorfahren und kombiniert sie mit einem GespÃ¼r fÃ¼r zeitgemÃ¤ÃŸe Eleganz.</p>
<p>Der Laden atmet Geschichte. Alte Schneiderscheren, NÃ¤hmaschinen aus vergangenen Epochen und vergilbte Schnittmuster schmÃ¼cken die WÃ¤nde. In Regalen stapeln sich schwere Stoffballen in gedeckten, klassischen Farben - Schwarz, Marineblau, DunkelgrÃ¼n und verschiedene BrauntÃ¶ne. Der Duft von Wollstoffen und Bienenwachs erfÃ¼llt den Raum.</p>
<p>FÃ¼r den festlichen Empfang schlÃ¤gt Gottfried einen klassischen Gehrock aus schwerem, nachtblauem Wollstoff vor, gefÃ¼ttert mit feinster Seide. Die KnÃ¶pfe werden aus poliertem Horn gefertigt, jeder ein Unikat. Dazu empfiehlt er eine Weste aus cremefarbenem Brokat mit einem subtilen Muster und Beinlinge aus feinem, anthrazitfarbenem Wollstoff.</p>
<p>Die Anpassung des Gewandes ist ein zeitaufwÃ¤ndiger Prozess, bei dem Gottfried Techniken anwendet, die er von seinem GroÃŸvater erlernt hat. Er erklÃ¤rt seinem edlen Kunden die Vorteile jeder Naht und jeden Schnitts, wie sie Haltbarkeit und Tragekomfort erhÃ¶hen. Besonders stolz ist er auf seine handgenÃ¤hten KnopflÃ¶cher, die er als kleine Kunstwerke betrachtet.</p>
<p>Gottfried legt groÃŸen Wert darauf, dass das Gewand nicht nur gut aussieht, sondern auch praktisch ist. Er fÃ¼gt versteckte Taschen hinzu, passt die LÃ¤nge des Gehrocks perfekt an die KÃ¶rpergrÃ¶ÃŸe an und achtet darauf, dass alle Bewegungen bequem mÃ¶glich sind. Als besondere Tradition der "Goldenen Schere" wird in jedes KleidungsstÃ¼ck ein kleiner GlÃ¼cksbringer eingenÃ¤ht - ein winziges StÃ¼ck roten Stoffes, das Wohlstand und langes Leben verheiÃŸen soll.</p>
<p>Zum Abschluss prÃ¤sentiert Gottfried eine Auswahl an Accessoires, die seit Generationen in seiner Familie weitergegeben wurden: Krawattennadeln, ManschettenknÃ¶pfe und TaschentÃ¼cher aus feinstem Leinen, jedes mit einer eigenen Geschichte. Er bietet an, eines dieser ErbstÃ¼cke als "Leihgabe" fÃ¼r den besonderen Anlass zur VerfÃ¼gung zu stellen, um dem Outfit den letzten Schliff zu geben.</p>
<h3 data-heading="Der edle Schneider &quot;Zum Goldenen Praiosfaden&quot;">Der edle Schneider "Zum Goldenen Praiosfaden"</h3>
<p>In einer engen Gasse Gareths, der Hauptstadt des Mittelreichs, zwischen FachwerkhÃ¤usern eingezwÃ¤ngt, befindet sich die Schneiderei "Zum Goldenen Praiosfaden". Ein kunstvoll geschnitztes Schild mit einer goldenen Nadel und Faden, die das Symbol Praios' nachahmen, weist den Weg. Durch die bleiverglaste TÃ¼r betritt man einen Raum, der von feinen Stoffen und dem Duft von Bienenwachs erfÃ¼llt ist.</p>
<p>Der Meisterschneider Garibald von Gareth, ein hagerer Mann mit flinken Fingern und scharfem Auge, begrÃ¼ÃŸt seine adlige Kundschaft mit einer tiefen Verbeugung. An den WÃ¤nden hÃ¤ngen Stoffbahnen in satten Farben - scharlachrotes Tuch aus Al'Anfa, azurblaue Seide aus Khunchom und golddurchwirkter Brokat aus Fasar.</p>
<p>In einer Ecke arbeiten Gesellen eifrig an NÃ¤hten und Stickereien. Auf einem massiven Eichentisch liegen MusterbÃ¼cher mit den neuesten ModeentwÃ¼rfen aus Vinsalt und Punin. Garibald prÃ¤sentiert seinem edlen Kunden die feinsten Materialien fÃ¼r ein prÃ¤chtiges Wams: Samt in tiefen Burgunderrot, mit goldenen FÃ¤den durchzogen, die das Wappen des Hauses Rabenmund darstellen.</p>
<p>Mit geÃ¼btem Blick nimmt er MaÃŸ und skizziert einen Entwurf, der die breiten Schultern des Adligen betont. Er schlÃ¤gt vor, die Ã„rmel mit Schlitzen zu versehen, durch die das schneeweiÃŸe Leinenhemd hindurchschimmern wird - der letzte Schrei der Mode am Hofe Kaiser Hals.</p>
<p>FÃ¼r die Beinlinge empfiehlt er eng anliegendes Tuch in einem dunklen GrÃ¼n, das perfekt mit dem Wams harmoniert und an die WÃ¤lder des Reichsforstes erinnert. Als krÃ¶nenden Abschluss prÃ¤sentiert Garibald einen mit Fuchspelz gefÃ¼tterten Umhang aus feinstem Wollstoff aus Weiden, der die noble Erscheinung abrunden wird.</p>
<p>Garibald: "Ich verstehe". Nun grÃ¼n und schwarz harmonieren ganz vorzÃ¼glich - dazu ein hauch von Gold. Ja ich kann es bereits vor mir sehen ich denke vielleicht also ein GrÃ¼ner Rock, durchwirkt mit Gold mit geschlitzen Ã„rmeln, dazu ein weiÃŸes Hemd mit Spitzenbesatz. Goldene oder silberne KnÃ¶pfe mit eurem Wappen oder Monogram wÃ¼rden gar vorzÃ¼glich damit harmonieren. Eine Schwarze Hose aus feinstem Elfenbausch mit einer goldenen Ziernaht die entlang der Beinlinge verlÃ¤uft. Dazu grÃ¼ne oder weiÃŸe Socken und grÃ¼ne Gamaschen oder schwarze Stiefel. Als krÃ¶nenden Abschluss prÃ¤sentiert Garibald einen mit Fuchspelz gefÃ¼tterten Umhang aus feinstem Wollstoff aus Weiden, der die noble Erscheinung abrunden wird.</p>
<h3 data-heading="&quot;Zum magischen Faden&quot; - Meisterschneiderei">"Zum magischen Faden" - Meisterschneiderei</h3>
<p>In einer der vornehmsten Gassen Gareths, unweit des Praios-Tempels, befindet sich die renommierte Schneiderei "Zum Goldenen Faden". Das GebÃ¤ude selbst ist ein architektonisches Kleinod, mit kunstvoll geschnitzten Holzornamenten und groÃŸen Schaufenstern, in denen die neuesten Kreationen zur Schau gestellt werden.</p>
<p>Meister Alrik von Gareth, ein hagerer Mann mit scharfem Blick und flinken Fingern, leitet dieses Etablissement mit PrÃ¤zision und Leidenschaft. Seine Werkstatt im hinteren Teil des Ladens gleicht einem Heiligtum der Schneiderkunst, wo feinste Stoffe aus allen Teilen Aventuriens verarbeitet werden.</p>
<p>Das Besondere an "Zum Goldenen Faden" ist die Verwendung magisch veredelter FÃ¤den, die von Alriks Schwester, einer Gildenmagierin, verzaubert werden. Diese FÃ¤den verleihen den GewÃ¤ndern nicht nur einen Ã¼bernatÃ¼rlichen Glanz, sondern auch subtile magische Eigenschaften wie Schmutzabweisung oder Temperaturregulierung.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Alrik ein Ensemble aus scharlachrotem Brokat aus Al'Anfa, bestickt mit goldenen FÃ¤den, die das Wappen des Adligen darstellen. Das Wams wird mit KnÃ¶pfen aus Mondsilber versehen, wÃ¤hrend die Beinlinge aus feinstem Leder gefertigt sind, das so weich ist, dass es wie eine zweite Haut anliegt.</p>
<p>Die Anprobe gleicht einem Ritual, bei dem Alrik jeden Zentimeter des Stoffes prÃ¼ft und anpasst, bis die Perfektion erreicht ist. Seine Assistenten, allesamt MeisterschÃ¼ler der renommiertesten Schneiderakademien des Reiches, stehen bereit, um jede Nadel und jeden Faden zu reichen.</p>
<h3 data-heading="&quot;Praiosgold&quot; - Imperiale Pracht">"Praiosgold" - Imperiale Pracht</h3>
<p>In einem prachtvollen Stadtpalais nahe des Kaiserpalastes residiert "Praiosgold". Der Laden empfÃ¤ngt seine Kunden mit einer Fassade aus glÃ¤nzendem Marmor und goldenen Verzierungen.</p>
<p>Meister Aurelius von Grangor, ein distinguierter Herr mit makellosem Auftreten, leitet das GeschÃ¤ft. Der Empfangsraum gleicht einem Thronsaal, mit hohen Spiegeln und kristallenen Kronleuchtern.</p>
<p>"Praiosgold" spezialisiert sich auf GewÃ¤nder, die imperiale Macht und gÃ¶ttliche AutoritÃ¤t ausstrahlen. Hier findet man:</p>

<ul>
<li>Prunkvolle Roben in Goldbrokat, besetzt mit echten Edelsteinen</li>
<li>MÃ¤ntel aus schimmernder Seide, deren Muster subtil das kaiserliche Wappen nachbilden</li>
<li>Kopfbedeckungen, die an stilisierte Kronen erinnern</li>
</ul>
<p>Jedes KleidungsstÃ¼ck wird individuell angefertigt und soll den TrÃ¤ger wie einen lebenden Vertreter des GÃ¶tterfÃ¼rsten Praios erscheinen lassen.</p>
<h3 data-heading="&quot;Rondras RÃ¼stkammer&quot; - Martialische Eleganz">"Rondras RÃ¼stkammer" - Martialische Eleganz</h3>
<p>In einem burgÃ¤hnlichen GebÃ¤ude im Adelsvirtel befindet sich "Rondras RÃ¼stkammer". Der Eingang wird von zwei lebensgroÃŸen Ritterstatuen flankiert.</p>
<p>Die Besitzerin, Alrike von Mersingen, eine ehemalige Ritterin mit imposanter PrÃ¤senz, begrÃ¼ÃŸt ihre Kunden persÃ¶nlich. Der Innenraum erinnert an eine prachtvolle Waffenhalle, mit Wandteppichen heroischer Schlachten und kunstvoll arrangierten RÃ¼stungsteilen.</p>
<p>"Rondras RÃ¼stkammer" bietet Festtagskleidung, die martialische Eleganz mit hÃ¶fischer Etikette verbindet:</p>
<ul>
<li>WÃ¤mser aus feinstem Leder, verziert mit filigranen Metallapplikationen</li>
<li>UmhÃ¤nge, die an WaffenrÃ¶cke erinnern, jedoch aus luxuriÃ¶sen Stoffen gefertigt sind</li>
<li>Schmuck, der subtil Waffen und RÃ¼stungsteile nachahmt</li>
</ul>
<p>Die Kreationen vermitteln kriegerische StÃ¤rke, ohne dabei die Grenzen der Hofetikette zu Ã¼berschreiten.</p>
<h3 data-heading="&quot;Travias Herd&quot; - FamiliÃ¤re WÃ¼rde">"Travias Herd" - FamiliÃ¤re WÃ¼rde</h3>
<p>In einem gemÃ¼tlichen, mehrstÃ¶ckigen BÃ¼rgerhaus am Praioshof befindet sich "Travias Herd". Der Eingang ist von einem Ã¼ppigen Blumengarten umgeben.</p>
<p>Die Schneidermeisterin Alina Friedenstochter, eine mÃ¼tterliche Frau mit warmem LÃ¤cheln, leitet den Laden. Der Innenraum erinnert an ein nobles Wohnzimmer, mit bequemen Sesseln und einem stets brennenden Kamin.</p>
<p>"Travias Herd" spezialisiert sich auf Kleidung, die familiÃ¤re WÃ¼rde und Tradition betont:</p>
<ul>
<li>Ensembles, die subtil Familienwappen und -farben integrieren</li>
<li>GenerationenÃ¼bergreifende Designs, die Eltern und Kinder harmonisch einkleiden</li>
<li>Accessoires, die FamilienerbstÃ¼cke elegant in moderne Moden einbinden</li>
</ul>
<p>Diese GewÃ¤nder sollen die Bedeutung von Familie und Abstammung am Hof unterstreichen, ohne protzig zu wirken.</p>
<h3 data-heading="&quot;Mondscheinweberei&quot; - Elfische Gewandungen am Rosenplatz">"Mondscheinweberei" - Elfische Gewandungen am Rosenplatz</h3>
<p>Am Rosenplatz, einem der schÃ¶nsten Orte Gareths, steht ein uralter Eichenbaum, in dessen Krone sich die "Mondscheinweberei" befindet. Silbrige Treppen, die sich perfekt in die Architektur des Platzes einfÃ¼gen, fÃ¼hren zu einer eleganten Plattform in den Ã„sten.</p>
<p>Die elfische Weberin Larianel, eine Botschafterin des Waldelfenreiches, empfÃ¤ngt hier Kunden mit anmutiger Gelassenheit. Ihre GewÃ¤nder scheinen aus Mondlicht und dem Tau des Garether Rosengartens gewoben. In der Luft schweben schimmernde Stoffe, die ihre Farbe je nach Tageszeit Ã¤ndern, inspiriert von den wechselnden Lichtern der Kaiserstadt.</p>
<p>Larianel fertigt Kleidung, die die Eleganz der elfischen Kultur mit dem Prunk des kaiserlichen Hofes verbindet. MÃ¤ntel aus immergrÃ¼nen BlÃ¤ttern, verziert mit goldenen FÃ¤den, die das Wappen des Mittelreiches nachbilden, Hemden aus Spinnenseide, so leicht wie der Nebel Ã¼ber dem GroÃŸen Fluss, und Schuhe aus weichem Leder, die lautlos Ã¼ber Marmor und Parkett gleiten.</p>
<p>FÃ¼r besondere Kunden, wie hohe Adlige oder kaiserliche Gesandte, webt Larianel GewÃ¤nder mit subtiler elfischer Magie: UmhÃ¤nge, die in den geschÃ¤ftigen StraÃŸen Gareths Ruhe und Gelassenheit vermitteln, Kleider, die vor den Intrigen des Hofes schÃ¼tzen, oder Handschuhe, die jede BerÃ¼hrung in harmonische Diplomatie verwandeln.</p>
<h3 data-heading="&quot;Zur Bunten Karawane&quot; - Exotische Moden am Neumarkt">"Zur Bunten Karawane" - Exotische Moden am Neumarkt</h3>
<p>Auf dem Neumarkt, dem pulsierenden Herzen des Garether Handels, steht ein farbenfrohes Ensemble aus Zelten und Wagen - die "Bunte Karawane". Hier findet man Mode aus allen Teilen des Mittelreiches und darÃ¼ber hinaus.</p>
<p>Die Besitzerin, die geschÃ¤ftstÃ¼chtige HÃ¤ndlerin Shaila von Gareth, ist eine lebhafte Frau mit scharfem Verstand und einer Vorliebe fÃ¼r die neuesten Modetrends aus allen Provinzen des Reiches. In ihren Zelten herrscht ein Gewirr aus Farben, DÃ¼ften und KlÃ¤ngen, die die Vielfalt der Kaiserstadt widerspiegeln.</p>
<p>Jeder Wagen reprÃ¤sentiert eine andere Region des Reiches: Prunkvolle Roben aus Vinsalt neben praktischen JagdgewÃ¤ndern aus dem Weiden, festliche Trachten aus dem Kosch neben eleganten Uniformen der kaiserlichen Garde. Shaila kennt die Geschichte und Bedeutung jedes einzelnen StÃ¼cks und versteht es, sie perfekt an die BedÃ¼rfnisse der Garether Gesellschaft anzupassen.</p>
<p>FÃ¼r die Oberschicht Gareths hÃ¤lt Shaila besondere SchÃ¤tze bereit: GewÃ¤nder, die einst von berÃ¼hmten Helden des Mittelreiches getragen wurden, magische Accessoires aus den entlegensten Provinzen oder KleidungsstÃ¼cke, die angeblich vom Kaiser selbst in Auftrag gegeben wurden.</p>
<h3 data-heading="&quot;Zum magischen Zwirn&quot; - Meisterschneiderei">"Zum magischen Zwirn" - Meisterschneiderei</h3>
<p>In einer der vornehmsten Gassen Gareths, unweit des prachtvollen Hesinde Tempels, befindet sich die renommierte Schneiderei "Zum Goldenen Faden". Das GebÃ¤ude selbst ist ein architektonisches Kleinod, mit kunstvoll geschnitzten Holzornamenten und groÃŸen Schaufenstern, in denen die neuesten Kreationen zur Schau gestellt werden. Meister Alrik von Gareth, ein hagerer Mann mit scharfem Blick und flinken Fingern, leitet dieses Etablissement mit PrÃ¤zision und Leidenschaft.</p>
<p>Die Besonderheit des "magischen Zwirns" liegt in der Verwendung magisch veredelter FÃ¤den, die von Alriks Schwester, einer Gildenmagierin, verzaubert werden. Diese FÃ¤den verleihen den GewÃ¤ndern nicht nur einen Ã¼bernatÃ¼rlichen Glanz, sondern auch subtile magische Eigenschaften wie Schmutzabweisung oder Temperaturregulierung.</p>
<p>Beim Betreten des Ladens wird der edle Kunde von einem Duft aus feinstem Bienenwachs und edlen HÃ¶lzern empfangen. Die WÃ¤nde sind mit Stoffbahnen in satten Farben behangen - scharlachrotes Tuch aus Al'Anfa, azurblaue Seide aus Khunchom und golddurchwirkter Brokat aus Fasar. In einer Ecke arbeiten Gesellen eifrig an NÃ¤hten und Stickereien, wÃ¤hrend auf einem massiven Eichentisch MusterbÃ¼cher mit den neuesten ModeentwÃ¼rfen aus Vinsalt und Punin ausliegen.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Alrik ein Ensemble aus scharlachrotem Brokat, bestickt mit goldenen FÃ¤den, die das Wappen des Adligen darstellen. Das Wams wird mit KnÃ¶pfen aus Mondsilber versehen, wÃ¤hrend die Beinlinge aus feinstem Leder gefertigt sind, das so weich ist, dass es wie eine zweite Haut anliegt. Die Anprobe gleicht einem Ritual, bei dem Alrik jeden Zentimeter des Stoffes prÃ¼ft und anpasst, bis die Perfektion erreicht ist.</p>
<p>Alrik erklÃ¤rt seinem edlen Kunden die Besonderheiten jedes Stoffes, von der Herkunft der Seide bis zur komplexen Webtechnik des Brokats. Er betont, wie die magischen FÃ¤den subtil eingearbeitet wurden, um die natÃ¼rliche Ausstrahlung des TrÃ¤gers zu verstÃ¤rken, ohne dabei aufdringlich zu wirken. Als krÃ¶nenden Abschluss prÃ¤sentiert Alrik einen Umhang aus schwerem, nachtblauem Samt, dessen Innenfutter mit einer Karte des Sternenhimmels bestickt ist - ein subtiler Hinweis auf die kosmische Ordnung und die Stellung des Adels darin.</p>
<h3 data-heading="&quot;Farbenzauber&quot; - StoffÃ¤rberei und Musterweberei">"Farbenzauber" - StoffÃ¤rberei und Musterweberei</h3>
<p>Am Ufer des GroÃŸen Flusses, in einem bunten Fachwerkhaus, befindet sich "Farbenzauber". Der Laden ist von einem Ã¼ppigen Garten umgeben, in dem seltene Pflanzen fÃ¼r Farbstoffe kultiviert werden. Der Duft exotischer BlÃ¼ten und KrÃ¤uter erfÃ¼llt die Luft und zieht Besucher magisch an.</p>
<p>Meisterin Iris Buntweberin, eine lebhafte Frau mit farbbefleckten HÃ¤nden und stets wechselnden Haarfarben, leitet das GeschÃ¤ft mit ansteckender Begeisterung. Ihre Werkstatt ist ein Labyrinth aus FÃ¤rbebottichen, WebstÃ¼hlen und Trockengestellen, wo Stoffe in allen erdenklichen Farben und Mustern entstehen.</p>
<p>Das Besondere an "Farbenzauber" ist Iris' einzigartige FÃ¤higkeit, Stoffe zu fÃ¤rben, die ihre Farbe je nach Licht oder Stimmung des TrÃ¤gers Ã¤ndern kÃ¶nnen. Sie erreicht dies durch eine Kombination aus alchemistischen FÃ¤rbemitteln und feiner Illusionsmagie, ein Geheimnis, das sie von einer reisenden Hexe aus dem Hohen Norden erlernt hat.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Iris einen Stoff, der tagsÃ¼ber in einem tiefen Blau schimmert, bei Kerzenlicht jedoch einen purpurnen Glanz annimmt. Das eingewebte Muster zeigt subtile Szenen aus der Geschichte des Adelshauses, die nur aus bestimmten Blickwinkeln sichtbar werden - ein faszinierendes GesprÃ¤chsthema fÃ¼r jeden Ball.</p>
<p>Der Auswahlprozess gleicht einer Farbberatung, bei der Iris nicht nur die Hautfarbe und Haarfarbe des Kunden berÃ¼cksichtigt, sondern auch dessen PersÃ¶nlichkeit und die gewÃ¼nschte Wirkung bei Hofe. Sie erklÃ¤rt, wie bestimmte Farben und Muster die Wahrnehmung anderer beeinflussen kÃ¶nnen, von Respekt einflÃ¶ÃŸend bis charmant und zugÃ¤nglich.</p>
<p>Iris fÃ¼hrt ihren edlen Kunden durch einen Raum voller schimmernder Stoffbahnen, jede mit einer eigenen Geschichte und Bedeutung. Sie erzÃ¤hlt von den Reisen, die sie unternommen hat, um seltene Farbstoffe zu finden, und von den Geheimnissen der Farbmagie, die sie in den entlegensten Winkeln Aventuriens entdeckt hat.</p>
<h2 data-heading="Schuster">Schuster</h2>
<h3 data-heading="Lerikes Schuhladen">Lerikes Schuhladen</h3>
<p><a href="DSA Kampagne/00 Dashboard/01 Szenentexte/Szene Im Schuhladen.md">Szene Im Schuhladen</a></p>
<h3 data-heading="**â€žDer Edle Trittâ€œ â€“ Schuhwerk fÃ¼r den feinen Gang**"><strong>â€žDer Edle Trittâ€œ â€“ Schuhwerk fÃ¼r den feinen Gang</strong></h3>
<p>Versteckt zwischen zwei imposanten FachwerkhÃ¤usern im gehobenen Stadtviertel von Gareth findet man â€žDer Edle Trittâ€œ, eine kleine, elegante Boutique, deren kunstvoll geschnitztes Schild ein stilisiertes Paar Lederstiefel auf goldenem Grund zeigt. Der Laden ist ein Refugium fÃ¼r wohlhabende BÃ¼rger, Adelige und Diplomaten, die Wert auf Haltung und Stil legen. Beim Eintreten umfÃ¤ngt einen der warme Duft von gegerbtem Leder, Bienenwachs und RosenÃ¶l. Die WÃ¤nde sind mit Regalen gesÃ¤umt, auf denen sich feinstes Schuhwerk aus unterschiedlichsten Materialien prÃ¤sentiert: hochgeschnÃ¼rte Stiefel mit silbernen Ã–sen, zierliche Slipper mit Goldstickerei, sogar weiche Pantoffeln aus dunkelblauem Samt mit Perlenbesatz.</p>
<p>In der Mitte des Raumes steht ein polierter, niedriger Podest aus dunklem Nussholz, auf dem Kunden ihre Schuhe anprobieren â€“ stets mit einem Spiegel aus echtem Glas daneben, eingefasst in filigranem Messing. Ein leiser Klang von Laute und Cembalo erklingt aus einem kleinen MusikspielgerÃ¤t im Hintergrund und unterstreicht die kultivierte AtmosphÃ¤re.</p>
<p>Der Besitzer, <strong>Meister Rodrigo Terme</strong>, ist ein Mann in den besten Jahren mit sÃ¼dlÃ¤ndischer Eleganz. Sein Haar, pechschwarz und glatt zurÃ¼ckgekÃ¤mmt, rahmt ein schmal geschnittenes, leicht gebrÃ¤untes Gesicht mit feinen ZÃ¼gen. Sein Oberlippenbart ist akkurat gestutzt, seine Bewegungen sind geschmeidig wie ein TÃ¤nzer. Er trÃ¤gt eine cremefarbene Seidenbluse mit hochgestelltem Kragen, darÃ¼ber einen taillierten Gehrock aus moosgrÃ¼nem Brokat mit goldenen FÃ¤den. Seine schmalen Lederstiefel, die er selbst gefertigt hat, glÃ¤nzen wie poliertes Ebenholz. Rodrigo spricht mit sanfter Stimme, wÃ¤hlt seine Worte mit Bedacht und strahlt eine Aura von kultivierter Raffinesse aus.</p>
<p>Ihm zur Seite steht <strong>Magda</strong>, eine resolute, aber freundliche Frau mit krÃ¤ftigem KÃ¶rperbau und rotem Haar, das sie unter einem einfachen LeinenhÃ¤ubchen trÃ¤gt. Sie kÃ¼mmert sich um die Anprobe, misst FÃ¼ÃŸe mit silbernen MaÃŸbÃ¤ndern und kennt jede Nuance der Lederpflege. Ihr Arbeitskittel aus grauem Leinen ist mit einem Gurt versehen, an dem BÃ¼rsten, kleine HÃ¤mmerchen und PoliertÃ¼cher hÃ¤ngen. Ihre Augen blicken stets wach und freundlich, und trotz ihres rauen Tons ist ihre Beratung hervorragend.</p>
<p>Die Schuhe aus dem â€žEdlen Trittâ€œ sind weit mehr als GebrauchsgegenstÃ¤nde. Sie sind ein Versprechen an Stil, Komfort und die subtile Macht, mit jedem Schritt Eindruck zu hinterlassen.</p>
<h3 data-heading="Der Schuster &quot;Zum Tanzenden Firunschuh&quot;">Der Schuster "Zum Tanzenden Firunschuh"</h3>
<p>Nur wenige Schritte entfernt befindet sich die Werkstatt des Schusters Gorbas. Der Geruch von Leder und Bienenwachs dringt bereits auf die StraÃŸe. Im Inneren empfÃ¤ngt den Adligen eine Auslage feinster Schuhe auf polierten Holzregalen.</p>
<p>Meister Gorbas, ein stÃ¤mmiger Thorwaler mit ledernen SchÃ¼rze, verneigt sich tief. Er prÃ¤sentiert verschiedene Modelle: elegante Schnabelschuhe mit extra langen Spitzen, wie sie derzeit am Hofe der KÃ¶nigin von Thorwal getragen werden, robuste Reitstiefel aus gewachstem Ochsenleder und leichte Tanzschuhe aus weichem Ziegenleder aus den Koschbergen.</p>
<p>FÃ¼r den festlichen Anlass empfiehlt er ein Paar Poulaines aus feinstem Maraskanleder in tiefem Schwarz. Die extravagant langen Spitzen werden mit Rosshaar ausgestopft, um ihre Form zu bewahren. Silberne Schnallen, verziert mit dem Symbol des Herren Firun, und feine Stickereien an den Seiten unterstreichen den edlen Charakter.</p>
<p>Gorbas nimmt sorgfÃ¤ltig MaÃŸ und erklÃ¤rt, wie er die Sohlen mit einer dÃ¼nnen Schicht Kork aus den WÃ¤ldern des Windhags polstern wird, um hÃ¶chsten Tragekomfort zu gewÃ¤hrleisten. Er verspricht, die Schuhe rechtzeitig fertigzustellen und persÃ¶nlich zu liefern.</p>
<details data-callout="note" class="callout"><summary>Poulaines</summary><div>
<p>Poulaines, auch als Schnabelschuhe bekannt, waren eine extravagante Schuhmode des SpÃ¤tmittelalters, die besonders im 15. Jahrhundert ihre BlÃ¼tezeit erlebte. Diese Schuhe zeichneten sich durch folgende Merkmale aus:</p>
<h2 data-heading="Charakteristika der Poulaines">Charakteristika der Poulaines</h2>
<ul>
<li><strong>Extrem verlÃ¤ngerte Schuhspitzen:</strong> Die Vorderteile der Schuhe liefen spitz zu und konnten betrÃ¤chtliche LÃ¤ngen erreichen<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Statussymbol:</strong> Je lÃ¤nger die Schuhspitze, desto hÃ¶her der soziale Status des TrÃ¤gers. Adlige und wohlhabende BÃ¼rger trugen oft die extremsten Formen<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Funktionale Anpassungen:</strong> Bei besonders langen Spitzen mussten diese mit Ketten am Bein befestigt werden, um das Gehen zu erleichtern<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Verbreitung:</strong> Die Mode der Poulaines war in ganz Europa verbreitet, von England bis Italien<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
</ul>
<h2 data-heading="Soziale und kulturelle Bedeutung">Soziale und kulturelle Bedeutung</h2>
<ul>
<li><strong>Symbol fÃ¼r Wohlstand:</strong> Die Ã¼bertriebene LÃ¤nge der Schuhe zeigte, dass der TrÃ¤ger nicht fÃ¼r kÃ¶rperliche Arbeit geeignet war<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Gesetzliche Regulierungen:</strong> In einigen Gebieten wurden sogar Gesetze erlassen, die die maximale LÃ¤nge der Schuhspitzen regulierten<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Modische Innovation:</strong> Poulaines markierten einen HÃ¶hepunkt der mittelalterlichen Schuhmode und beeinflussten spÃ¤tere Schuhdesigns<a href="https://www.historische-schuhe.de/renaissance-pantoffeln-schuhe/">3</a>.</li>
</ul>
<p>Die Poulaines waren mehr als nur Schuhe; sie waren ein bedeutendes Mode- und Statussymbol ihrer Zeit, das die sozialen Hierarchien und den Geschmack der spÃ¤tmittelalterlichen Gesellschaft widerspiegelte.</p>
</div></details>
<h3 data-heading="&quot;Schritt &amp; Tritt&quot; - Schuhmacherei der Extraklasse">"Schritt &amp; Tritt" - Schuhmacherei der Extraklasse</h3>
<p>Am Rosenplatz, dem Zentrum des Garether Handwerksviertels, findet sich die Schuhmacherei "Schritt &amp; Tritt". Das LadengeschÃ¤ft ist von auÃŸen unscheinbar, doch wer eintritt, betritt eine Welt des Luxus und der Handwerkskunst.</p>
<p>Meister Gorbas, ein stÃ¤mmiger Thorwaler mit Ã¼berraschend sanften HÃ¤nden, hat sich hier niedergelassen und seine nordische Handwerkskunst mit mittellÃ¤ndischer Eleganz verbunden. Seine Werkstatt im Untergeschoss ist ein Labyrinth aus Leisten, HÃ¤uten und exotischen Materialien.</p>
<p>Das Einzigartige an "Schritt &amp; Tritt" ist Gorbas' FÃ¤higkeit, Schuhe zu fertigen, die sich der FuÃŸform des TrÃ¤gers anpassen und mit der Zeit "mitwachsen". Er erreicht dies durch eine geheime Mischung aus KrÃ¤utern und Ã–len, mit denen er das Leder behandelt.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Gorbas ein Paar knÃ¶chelhohe Stiefel aus schwarzem Maraskanleder vor. Die Sohlen werden aus mehreren Schichten gefertigt, darunter eine Lage Kork aus den WÃ¤ldern des Windhags fÃ¼r hÃ¶chsten Komfort. Die Schnallen sind aus Silber gefertigt und tragen das Symbol des Adelshauses.</p>
<p>Der Anpassungsprozess ist langwierig und beinhaltet mehrere Anproben, bei denen Gorbas nicht nur MaÃŸ nimmt, sondern auch den Gang des Kunden studiert, um die perfekte Passform zu gewÃ¤hrleisten.</p>
<h2 data-heading="Waffenschmiede">Waffenschmiede</h2>
<h3 data-heading="**â€žZur Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den noblen Anlass**"><strong>â€žZur Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den noblen Anlass</strong></h3>
<p>Unweit der sÃ¼dlichen Stadtmauer von Gareth, dort wo das Grollen von HÃ¤mmern und das GlÃ¼hen der Esse das Stadtbild prÃ¤gen, liegt â€žZur Klingenschmiedeâ€œ, ein Laden wie aus einem Heldenlied. Schon von weitem hÃ¶rt man das rhythmische Klopfen auf Ambosse, riecht die Mischung aus glÃ¼hendem Eisen, Ã–l und Kohle und sieht Funken wie kleine Sterne durch die offene SchmiedetÃ¼r tanzen. Der Laden selbst ist halb Werkstatt, halb Ausstellungsraum. An den WÃ¤nden hÃ¤ngen fein gearbeitete Schwerter, elegante Parierdolche, prunkvolle Harnische und kunstvoll verzierte SÃ¤bel â€“ alle aus der Hand eines wahren Meisters.</p>
<p><strong>Meister Konrad Eisenfaust</strong> ist dieser Meister. Ein HÃ¼ne von einem Mann, mit bronzefarbener, sonnengegerbter Haut, zerzaustem grauschwarzem Haar und einem gewaltigen Vollbart. Seine stahlblauen Augen blicken wachsam und entschlossen, sein ganzer KÃ¶rper wirkt wie aus Eisen geschmiedet. Er trÃ¤gt eine ruÃŸgeschwÃ¤rzte LederschÃ¼rze Ã¼ber einem groben Kettenhemd â€“ eine ungewÃ¶hnliche, aber wirkungsvolle Kombination. Seine Unterarme sind mit alten Schmiedesymbolen tÃ¤towiert, und zahlreiche Brandnarben zeugen von Jahrzehnten im Dienst des Feuers. Auf seinem breiten LedergÃ¼rtel hÃ¤ngen Zangen, Feilen und eine Schmiedehammer-Miniatur als Amulett. Wenn er spricht, ist seine Stimme tief und rau wie das Kratzen von Stahl auf Stein.</p>
<p>An seiner Seite arbeitet <strong>Janko</strong>, sein Lehrling, ein etwa 14-jÃ¤hriger Junge mit wirrem blondem Haar und ruÃŸverschmiertem Gesicht. Trotz seiner Jugend hat er bereits die krÃ¤ftigen Arme eines Handwerkers und den wachen Blick eines KÃ¼nstlers. Sein kurzÃ¤rmliges Leinenhemd ist an den SÃ¤umen ausgefranst, sein Lederschurz voller Gebrauchsspuren, doch seine Bewegungen sind prÃ¤zise. Ein kleiner Hammer hÃ¤ngt an seiner Seite, ein Geschenk des Meisters, das er mit sichtbarem Stolz trÃ¤gt. Seine Hose ist schlicht, sein Gesicht voller Bewunderung fÃ¼r seinen Lehrherrn.</p>
<p>â€žZur Klingenschmiedeâ€œ steht fÃ¼r QualitÃ¤t und Ehre. Die Waffen, die hier entstehen, sind nicht nur Werkzeuge des Kampfes, sondern Kunstwerke â€“ geschaffen mit Feuer, Kraft und Seele. Wer hier ein Schwert ersteht, trÃ¤gt nicht bloÃŸ Stahl an seiner Seite, sondern ein Symbol fÃ¼r Mut, Adel und Meisterschaft.</p>
<h3 data-heading="Der Waffenschmied &quot;Zur Eisernen Rondrafaust&quot;">Der Waffenschmied "Zur Eisernen Rondrafaust"</h3>
<p>Am Stadtrand von Gareth, wo der LÃ¤rm der HÃ¤mmer ungestÃ¶rt erschallen kann, liegt die Schmiede von Meister Ungrimm. Rauch steigt aus der Esse, als der Adlige den ruÃŸgeschwÃ¤rzten Werkstattraum betritt. An den WÃ¤nden hÃ¤ngen blankpolierte Schwerter, Dolche und RÃ¼stungsteile.</p>
<p>Ungrimm, ein bulliger Zwerg mit vernarbten HÃ¤nden, wischt sich den SchweiÃŸ von der Stirn und verneigt sich. Er fÃ¼hrt seinen edlen Kunden zu einer Vitrine mit kunstvoll verzierten Prunkklingen. FÃ¼r den festlichen Anlass empfiehlt er einen eleganten Degen oder deutlich zivilisierter eine Stockdegen in Form von Rondras LÃ¶wenkopf und einem mit Rubinen besetzten Knauf.</p>
<p>Die schlanke Klinge ist aus bestem Zwergenstahl geschmiedet, mehrfach gehÃ¤rtet und so scharf, dass sie ein fallendes Haar spalten kÃ¶nnte. In die Klinge sind filigrane Ornamente und das Wappen des Adligen eingeÃ¤tzt, umrahmt von Runen, die Segen der ZwÃ¶lfgÃ¶tter verheiÃŸen.</p>
<p>Als ErgÃ¤nzung prÃ¤sentiert Ungrimm einen passenden Dolch mit Griff aus Drachenbein und einer wellenfÃ¶rmig geschmiedeten Klinge. Er erklÃ¤rt, dass beide Waffen zwar voll funktionsfÃ¤hig, aber in erster Linie als SchmuckstÃ¼cke und Statussymbole gedacht sind, wÃ¼rdig eines Reichsritters.</p>
<h3 data-heading="Die Waffenkammer &quot;Zum Blutigen Beil&quot;">Die Waffenkammer "Zum Blutigen Beil"</h3>
<p>Am Rande des SÃ¶ldnerviertels von Festum liegt die Waffenkammer von Grimm dem EinÃ¤ugigen. Das GebÃ¤ude gleicht einer Festung, mit dicken Steinmauern und vergitterten Fenstern. Ãœber dem Eingang hÃ¤ngt ein riesiges, rostiges Beil. Der Geruch von Ã–l, Leder und Metall schlÃ¤gt dem Besucher entgegen.</p>
<p>Grimm, ein bulliger Mann mit Augenklappe und zahllosen Narben, begrÃ¼ÃŸt Kunden mit einem grimmigen Nicken. Die WÃ¤nde sind bedeckt mit Waffen aller Art: Vom einfachen Dolch bis zur zweihÃ¤ndigen Kriegsaxt, von der leichten Armbrust bis zum thorwalschen Wurfbeil. In einer Ecke steht eine Sammlung exotischer Waffen aus fernen LÃ¤ndern.</p>
<p>FÃ¼r besonders kampferprobte Kunden Ã¶ffnet Grimm einen versteckten Kellerraum. Hier lagern magische Waffen von groÃŸer Macht: Schwerter, die nie rosten, Ã„xte, die RÃ¼stungen wie Butter durchschneiden, und BÃ¶gen, deren Pfeile ihr Ziel niemals verfehlen. Doch Grimm warnt: Diese Waffen haben oft einen eigenen Willen und sind nicht fÃ¼r schwache GemÃ¼ter geeignet</p>

<h3 data-heading="Thorn Eisinger">Thorn Eisinger</h3>
<h2 data-heading="Hutmacher">Hutmacher</h2>
<h3 data-heading="Der Hutmacher &quot;Zur Traviafedern&quot;">Der Hutmacher "Zur Traviafedern"</h3>
<p>In einem schmucken Fachwerkhaus nahe des Traviatempels residiert Meister Farnwald, der renommierteste Hutmacher Gareths. Sein Laden ist ein Paradies aus Filz, Seide und exotischen Federn. Von der Decke hÃ¤ngen Modelle in allen erdenklichen Formen und Farben, von einfachen FilzhÃ¼ten bis zu extravaganten Kreationen fÃ¼r den Adel.</p>
<p>Farnwald, ein drahtiger Mann mit flinken HÃ¤nden und einem Auge fÃ¼r Details, begrÃ¼ÃŸt den Adligen Ã¼berschwÃ¤nglich. Er prÃ¤sentiert die neuesten Kreationen: breitkrempige HÃ¼te mit wallenden StrauÃŸenfedern aus den EchsensÃ¼mpfen, eng anliegende Barette aus feinstem Samt aus Almada und imposante Federbarets, wie sie derzeit am Hofe der Kaiserin getragen werden.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt er ein Barett aus grÃ¼nem oder schwarzen Samt vor, passend zum Wams. Es wird mit einer kunstvollen goldenen Agraffe geschmÃ¼ckt, in die ein groÃŸer Rubin eingelassen ist, der an das Auge Ingerimms erinnert. Eine lange weiÃŸe Reiherfeder vom GroÃŸen Fluss, soll als krÃ¶nender Abschluss dienen.</p>
<p>Farnwald nimmt sorgfÃ¤ltig MaÃŸ und verspricht, das Barett perfekt an die Kopfform des Adligen anzupassen. Er erklÃ¤rt, wie er den Samt Ã¼ber eine Holzform spannen und in Form bringen wird, bevor er die kostbaren Verzierungen anbringt, die von den besten Goldschmieden Gareths gefertigt wurden.</p>
<p>Mit diesen erlesenen StÃ¼cken von den besten Handwerkern der Kaiserstadt wird der Adlige zweifellos alle Blicke auf sich ziehen und seinem Stand alle Ehre machen, sei es bei einem Fest zu Ehren des Kaisers oder bei einer Audienz im Palast des FÃ¼rsten von Gareth.</p>
<h3 data-heading="&quot;Kronen &amp; Kappen&quot; - Hutmacherei mit Tradition">"Kronen &amp; Kappen" - Hutmacherei mit Tradition</h3>
<p>In einem verschachtelten Fachwerkhaus nahe der Magierakademie residiert die Hutmacherei "Kronen &amp; Kappen". Der Laden erstreckt sich Ã¼ber drei Etagen, jede gefÃ¼llt mit Kopfbedeckungen aller Art, von einfachen Filzkappen bis zu extravaganten FederhÃ¼ten.</p>
<p>Meisterin Firunja, eine exzentrische Frau mit wildem grauem Haar und stets wechselnden HÃ¼ten, fÃ¼hrt das GeschÃ¤ft in vierter Generation. Ihre Kreationen sind in ganz Aventurien bekannt und begehrt.</p>
<p>Die Besonderheit von "Kronen &amp; Kappen" liegt in Firunjas FÃ¤higkeit, HÃ¼te zu erschaffen, die sich dem Wetter anpassen. Durch eine Kombination aus alchemistischen TrÃ¤nken und subtiler Magie kÃ¶nnen ihre HÃ¼te bei Regen wasserabweisend werden oder bei starker Sonne zusÃ¤tzlichen Schatten spenden.</p>
<p>FÃ¼r den Empfang empfiehlt Firunja ein Barett aus dunkelblauem Samt, besetzt mit einer Reiherfeder vom GroÃŸen Fluss. Die Krempe ist mit feinen SilberfÃ¤den bestickt, die in der richtigen Beleuchtung wie Sterne funkeln. Eine dezente Agraffe aus Gold und Saphir hÃ¤lt die Feder an Ort und Stelle.</p>
<p>Die Anpassung des Hutes ist ein faszinierender Prozess, bei dem Firunja nicht nur den Kopfumfang misst, sondern auch die GesichtszÃ¼ge und sogar die PersÃ¶nlichkeit des Kunden in Betracht zieht, um die perfekte Form zu finden.</p>
<h2 data-heading="Juwelier">Juwelier</h2>
<h3 data-heading="&quot;Praiosglanz&quot; - Juwelier und Accessoiremeister">"Praiosglanz" - Juwelier und Accessoiremeister</h3>
<p>Im Herzen des Prachtviertels, nur einen Steinwurf vom Kaiserpalast entfernt, befindet sich "Praiosglanz", ein JuweliergeschÃ¤ft von unvergleichlichem Ruf. Das GebÃ¤ude selbst gleicht einem SchmuckstÃ¼ck, mit einer Fassade aus weiÃŸem Marmor und goldenen Verzierungen.</p>
<p>Meister Aurelius von Grangor, ein distinguierter Herr mit scharfem Blick und ruhigen HÃ¤nden, empfÃ¤ngt seine Kundschaft in einem Salon, der eher einem Thronsaal gleicht. Kristallene Kronleuchter werfen ihr Licht auf Vitrinen voller funkelnder Kostbarkeiten.</p>
<p>Die Einzigartigkeit von "Praiosglanz" liegt in Aurelius' FÃ¤higkeit, Edelsteine mit besonderen Eigenschaften zu schleifen. Durch eine Kombination aus prÃ¤ziser Handwerkskunst und subtiler Magie kÃ¶nnen seine SchmuckstÃ¼cke die Ausstrahlung des TrÃ¤gers verstÃ¤rken oder sogar vor bestimmten magischen EinflÃ¼ssen schÃ¼tzen.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Aurelius eine Garnitur aus mehreren StÃ¼cken vor: Eine feine Goldkette mit einem AnhÃ¤nger, der das Wappen des Adelshauses in Miniatur darstellt, besetzt mit winzigen Diamanten. Dazu passende ManschettenknÃ¶pfe aus WeiÃŸgold, in die Rubine eingelassen sind, die angeblich aus den Minen von Xorlosch stammen.</p>
<p>Die Auswahl und Anpassung der SchmuckstÃ¼cke ist ein zeremonieller Akt. Aurelius studiert nicht nur die Physiognomie des Kunden, sondern auch dessen Aura, um die perfekte Kombination von Metallen und Steinen zu finden, die die natÃ¼rliche PrÃ¤senz des TrÃ¤gers unterstreichen.</p>
<p>Jeder dieser LÃ¤den bietet nicht nur exquisite Waren, sondern auch ein einzigartiges Einkaufserlebnis, das den Besuch zu einem unvergesslichen Teil der Vorbereitung auf den festlichen Empfang macht. Die Meister ihres Fachs verstehen es, die BedÃ¼rfnisse und den Status ihrer adligen Kundschaft zu wÃ¼rdigen und zu bedienen, wodurch jedes erworbene StÃ¼ck zu einem wahren Kunstwerk wird.</p>
<h3 data-heading="Der Juwelier &quot;Zum Funkelnden Stern&quot;">Der Juwelier "Zum Funkelnden Stern"</h3>
<p>In einem prÃ¤chtigen Stadtpalais am Praioshof von Gareth residiert der Juwelier Aurelius von Grangor. Schon der Eingang ist ein Kunstwerk: Eine mit Edelsteinen besetzte TÃ¼r, deren Muster das Firmament nachbildet. Im Inneren empfÃ¤ngt den Besucher der Duft von exotischen RÃ¤ucherwerken und der sanfte Klang einer Kristallharfe.</p>
<p>Aurelius, ein distinguierter Herr mit gepflegtem Silberhaar und scharfem Blick, begrÃ¼ÃŸt seine Kundschaft mit kultivierter ZurÃ¼ckhaltung. In kristallenen Vitrinen prÃ¤sentiert er erlesene SchmuckstÃ¼cke: Diademe aus Mithril, besetzt mit Sternenrubinen aus den Minen von Xorlosch, Colliers aus Mondsilber mit schimmernden Perlen aus den SÃ¼dmeeren und Ringe, deren Edelsteine magisch behandelt wurden, um das Licht der Sterne einzufangen.</p>
<p>FÃ¼r besonders diskrete Kunden Ã¶ffnet Aurelius einen verborgenen Raum, in dem er Artefakte von groÃŸer magischer Macht und zweifelhafter Herkunft aufbewahrt. Hier finden sich Amulette mit geheimnisvollen KrÃ¤ften, Ringe, die ihren TrÃ¤ger vor Zaubern schÃ¼tzen, und Edelsteine, in denen angeblich die Seelen lÃ¤ngst vergangener Helden gebunden sind.</p>
<p>Hier ist eine Liste von fÃ¼nf fiktiven JuwelierlÃ¤den in Gareth, die sich an das mittelalterliche bzw. Rokoko-Setting Aventuriens anpassen. Jeder Laden hat seinen eigenen Stil, Kundschaft und Preissegment.</p>
<h3 data-heading="**Kronen &amp; Karfunkel**"><strong>Kronen &amp; Karfunkel</strong></h3>
<p><strong>Standort:</strong> Alt-Gareth, nahe der Neuen Residenz<br>
<strong>Beschreibung des Ladens:</strong> Kronen &amp; Karfunkel ist ein opulenter Juwelierladen, dessen Schaufenster mit schweren VorhÃ¤ngen aus Brokat verhÃ¼llt sind. Im Inneren glitzern funkelnde Kronleuchter Ã¼ber samtbezogenen Vitrinen, die mit Gold- und Edelsteinschmuck gefÃ¼llt sind. Der Boden besteht aus poliertem Marmor, und ein Sicherheitsmagier bewacht diskret die wertvollen Auslagen.<br>
<strong>Der Juwelier:</strong> Meisterin Elara von Glanzfels ist eine elegante Frau mit grauem Haar, das stets kunstvoll hochgesteckt ist. Sie stammt aus einer alten horasischen Familie und ist bekannt fÃ¼r ihre Expertise bei seltenen Edelsteinen wie Saphiren und Karfunkeln. Elara ist stolz auf ihre diskrete Art und berÃ¤t ihre wohlhabende Kundschaft persÃ¶nlich.<br>
<strong>Angestellte:</strong> Zwei Goldschmiede arbeiten in einer Werkstatt im hinteren Bereich des Ladens an maÃŸgeschneiderten SchmuckstÃ¼cken. Eine VerkÃ¤uferin kÃ¼mmert sich um die PrÃ¤sentation der Ware, wÃ¤hrend ein Lehrling die Vitrinen reinigt und kleinere Reparaturen Ã¼bernimmt.<br>
<strong>Preise und QualitÃ¤t:</strong> Sehr hochpreisig â€“ dieser Laden richtet sich ausschlieÃŸlich an den Adel und reiche HÃ¤ndlerfamilien, die nach Unikaten suchen.</p>
<h3 data-heading="**Der Funkelstein**"><strong>Der Funkelstein</strong></h3>
<p><strong>Standort:</strong> Neu-Gareth, in der NÃ¤he des Theaterviertels<br>
<strong>Beschreibung des Ladens:</strong> Der Funkelstein ist ein lebhafter Laden mit groÃŸen Fenstern, durch die Sonnenlicht auf die Auslagen fÃ¤llt. Die Einrichtung ist hell und freundlich, mit HolzbÃ¶den und farbenfrohen WandgemÃ¤lden, die Szenen aus Rahjas Mythen zeigen. In den Vitrinen finden sich SchmuckstÃ¼cke mit verspielten Designs, oft inspiriert von Blumen oder Tieren.<br>
<strong>Der Juwelier:</strong> Lysandro Goldblatt ist ein charmanter Mann mit einem Faible fÃ¼r extravagante Designs. Er trÃ¤gt selbst oft auffÃ¤lligen Schmuck und liebt es, seine Kundschaft zu beraten â€“ besonders KÃ¼nstler, Schauspieler und wohlhabende BÃ¼rger mit Sinn fÃ¼r KreativitÃ¤t.<br>
<strong>Angestellte:</strong> Zwei junge Goldschmiedinnen arbeiten an individuellen AuftrÃ¤gen, wÃ¤hrend ein Lehrling sich um die Kundenbetreuung kÃ¼mmert. Ein Barde sorgt mit leiser Musik fÃ¼r eine angenehme AtmosphÃ¤re im Laden.<br>
<strong>Preise und QualitÃ¤t:</strong> Oberer Mittelpreisbereich â€“ ideal fÃ¼r Kunden, die etwas Besonderes suchen, ohne ein VermÃ¶gen auszugeben.</p>
<h3 data-heading="**Die Zwergenkrone**"><strong>Die Zwergenkrone</strong></h3>
<p><strong>Standort:</strong> SÃ¼dquartier, nahe dem Zwergenkai<br>
<strong>Beschreibung des Ladens:</strong> Die Zwergenkrone ist ein kompakter Laden mit massiven SteinwÃ¤nden und einer robusten Einrichtung aus dunklem Holz. Die SchmuckstÃ¼cke werden in schweren Eisen-Vitrinen prÃ¤sentiert, die mit filigranen Zwergenrunen verziert sind. Der Fokus liegt auf funktionalem Schmuck wie Siegelringen und Amuletten mit Schutzrunen.<br>
<strong>Der Juwelier:</strong> Borgrim Steinhauer ist ein erfahrener Zwergenschmied mit einem beeindruckenden grauen Bart. Er legt groÃŸen Wert auf Handwerkskunst und Langlebigkeit seiner StÃ¼cke â€“ jedes SchmuckstÃ¼ck soll Generationen Ã¼berdauern. Borgrim ist wortkarg, aber seine Arbeit spricht fÃ¼r sich selbst.<br>
<strong>Angestellte:</strong> Eine zwergische Gesellin hilft bei der Herstellung von SchmuckstÃ¼cken, wÃ¤hrend Borgrims Tochter den Verkauf Ã¼bernimmt. Ein menschlicher Lehrling lernt das Handwerk unter strenger Aufsicht des Meisters.<br>
<strong>Preise und QualitÃ¤t:</strong> Mittelpreisig â€“ exzellente QualitÃ¤t zu fairen Preisen, besonders beliebt bei Handwerkern und pragmatischen BÃ¼rgern.</p>
<h3 data-heading="**Perlen &amp; Prunk**"><strong>Perlen &amp; Prunk</strong></h3>
<p><strong>Standort:</strong> Rosskuppel, im Viertel der HÃ¤ndler<br>
<strong>Beschreibung des Ladens:</strong> Perlen &amp; Prunk ist ein eleganter Laden mit einer Mischung aus FunktionalitÃ¤t und Stil. Die WÃ¤nde sind in warmen Farben gestrichen, und die Auslagen bestehen aus Glasvitrinen auf geschnitzten Holzsockeln. Der Schwerpunkt liegt auf Schmuck aus Silber sowie Perlenketten und Ohrringen â€“ perfekt fÃ¼r wohlhabende HÃ¤ndlerfamilien oder festliche AnlÃ¤sse.<br>
<strong>Der Juwelier:</strong> Roderika Silberglanz ist eine freundliche Frau mittleren Alters mit einem Auge fÃ¼r Details und Trends. Sie reist regelmÃ¤ÃŸig zu MÃ¤rkten in anderen StÃ¤dten, um neue Materialien einzukaufen oder Inspiration fÃ¼r ihre Designs zu finden.<br>
<strong>Angestellte:</strong> Zwei VerkÃ¤uferinnen kÃ¼mmern sich um die Beratung der Kunden, wÃ¤hrend ein Goldschmied im Hinterzimmer Reparaturen durchfÃ¼hrt oder neue StÃ¼cke anfertigt. Ein Laufbursche bringt Bestellungen zu den Kunden nach Hause.<br>
<strong>Preise und QualitÃ¤t:</strong> Moderat â€“ gute QualitÃ¤t zu erschwinglichen Preisen fÃ¼r HÃ¤ndlerfamilien oder BÃ¼rger mittleren Standes.</p>
<h3 data-heading="**Das Smaragdauge**"><strong>Das Smaragdauge</strong></h3>
<p><strong>Standort:</strong> Meilersgrund, am Rande des Marktplatzes<br>
<strong>Beschreibung des Ladens:</strong> Das Smaragdauge ist ein kleiner Laden mit schlichten HolzmÃ¶beln und einer gemÃ¼tlichen AtmosphÃ¤re. Die SchmuckstÃ¼cke sind einfach gehalten â€“ meist Silberringe oder kleine AnhÃ¤nger â€“, aber dennoch geschmackvoll gestaltet. In einer Ecke steht eine Werkbank, an der der Juwelier oft direkt vor den Augen der Kunden arbeitet.<br>
<strong>Der Juwelier:</strong> Thalion GrÃ¼nblick ist ein Halbelf mit geschickten HÃ¤nden und einem ruhigen Wesen. Er liebt es, Geschichten Ã¼ber seine Reisen durch Aventurien zu erzÃ¤hlen, wÃ¤hrend er SchmuckstÃ¼cke repariert oder neue Designs entwirft. Seine SpezialitÃ¤t sind filigrane Arbeiten wie gravierte Ringe oder kleine Amulette mit Naturmotiven.<br>
<strong>Angestellte:</strong> Keine â€“ Thalion arbeitet allein und schÃ¤tzt die persÃ¶nliche Verbindung zu seinen Kunden sehr. Gelegentlich nimmt er einen Lehrling auf, um sein Wissen weiterzugeben.<br>
<strong>Preise und QualitÃ¤t:</strong> GÃ¼nstig â€“ ideal fÃ¼r einfache BÃ¼rger oder Reisende auf der Suche nach einem kleinen Andenken.</p>
<p>Diese fÃ¼nf JuwelierlÃ¤den decken verschiedene Stadtteile Gareths sowie unterschiedliche Preisklassen ab â€“ vom luxuriÃ¶sen Kronjuwel bis hin zum einfachen Silberring fÃ¼r den Alltag!</p>
<h2 data-heading="Barbier">Barbier</h2>
<h3 data-heading="**Der Goldene Kamm**"><strong>Der Goldene Kamm</strong></h3>
<p><strong>Standort:</strong> Alt-Gareth, nahe der Neuen Residenz<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Der Goldene Kamm ist ein prÃ¤chtiger Salon mit vergoldeten Spiegelrahmen, polierten MarmorbÃ¶den und schweren SamtvorhÃ¤ngen. Die Einrichtung strahlt Luxus aus, von den geschnitzten FriseurstÃ¼hlen bis zu den Kristallkaraffen mit duftenden HaarÃ¶len.<br>
<strong>Der Barbier:</strong> Meister Irmlaus Sierra ist ein eleganter Mann mittleren Alters mit einem perfekt gepflegten Schnurrbart. Er ist bekannt fÃ¼r seine hÃ¶fliche Art und sein Talent, Frisuren zu kreieren, die dem neuesten Horas-Trend entsprechen.<br>
<strong>Angestellte:</strong> Drei Lehrlinge kÃ¼mmern sich um einfache Rasuren und HaarwÃ¤schen, wÃ¤hrend eine Alchimistin exklusive Duftmischungen herstellt. Ein Lakai serviert Tee und GebÃ¤ck an die Kundschaft.<br>
<strong>Preise und QualitÃ¤t:</strong> Sehr hochpreisig, aber unÃ¼bertroffen in QualitÃ¤t und Service. Nur die reichsten BÃ¼rger Gareths kÃ¶nnen sich diesen Salon leisten.</p>
<h3 data-heading="**â€žDer Edle Schnittâ€œ â€“ Der Barbier fÃ¼r Lords und Hohe Damen**"><strong>â€žDer Edle Schnittâ€œ â€“ Der Barbier fÃ¼r Lords und Hohe Damen</strong></h3>
<p>Im Herzen der Altstadt von Gareth, zwischen Marmorstatuen und kleinen Springbrunnen, steht ein Haus mit rot-weiÃŸem Stangenschild, das in spiralfÃ¶rmigem Muster Ã¼ber dem Eingang hÃ¤ngt. Der Laden trÃ¤gt den klangvollen Namen â€žDer Edle Schnittâ€œ und gilt unter Kennern als der Ort, an dem Haar, Bart und Haut mit hÃ¶chster Sorgfalt gepflegt werden. Der Eingangsbereich gleicht mehr einem Salon als einem Handwerksbetrieb: vergoldete Spiegel an den WÃ¤nden, weiche StÃ¼hle aus Mahagoni mit tiefgrÃ¼ner Polsterung und kleine Kristallleuchter, die ein warmes, sanftes Licht spenden.</p>
<p>Der Innenraum ist erfÃ¼llt vom Duft edler Pomaden, ZedernÃ¶l und feinen Rasierseifen. Instrumente aus Silber und Messing glÃ¤nzen ordentlich aufgereiht auf dunklen Ablagen: Scheren, Rasiermesser, BÃ¼rsten, glÃ¤serne Phiolen mit duftenden Essenzen. Im Hintergrund spielt leise eine Spieluhr eine alte aranische Melodie. Kunden, die hierherkommen, suchen nicht nur Pflege, sondern auch Prestige.</p>
<p><strong>Barbier Amando Calvero</strong> ist der unangefochtene Herr Ã¼ber Schere und Klinge. Von mittlerer GrÃ¶ÃŸe, mit olivfarbener Haut, fein geschwungenem Bart und dunklen, klugen Augen, bewegt er sich mit einer Eleganz, als tanze er durch seinen Laden. Sein Haar ist zu einem perfekten Knoten hochgebunden, ein Seidenband in Purpur hÃ¤lt es in Form. Er trÃ¤gt eine taillierte schwarze Weste mit goldener Stickerei, ein weiÃŸes Hemd mit RÃ¼schenmanschetten und ein langes, schimmerndes Halstuch in Mitternachtsblau. Seine Stimme ist weich, fast flÃ¼sternd, und er spricht mit dem Timbre eines BÃ¼hnenkÃ¼nstlers. Wenn er den Rasierpinsel schwingt oder mit dem Tuch um das Gesicht eines Kunden fÃ¤hrt, tut er das mit beinahe priesterlicher Andacht.</p>
<p>UnterstÃ¼tzt wird er von <strong>Serafin</strong>, einem schlaksigen, jungen Mann mit blassem Teint und hellblonden Locken, der fÃ¼r Ordnung, Duftmischungen und Haarpflegeprodukte zustÃ¤ndig ist. Er trÃ¤gt ein blassviolettes Arbeitsgewand mit seidigem Glanz und spricht stets hÃ¶flich, fast unterwÃ¼rfig. Daneben arbeitet <strong>Lysandra</strong>, eine rothaarige, energische Gesellin, die sich auf Damenfrisuren und ParfÃ¼merie versteht. Sie trÃ¤gt ein elegantes, aber praktisches Kleid mit SpitzenschÃ¼rze, stets parfÃ¼miert mit Lavendel.</p>
<p>â€žDer Edle Schnittâ€œ ist kein gewÃ¶hnlicher Barbier â€“ er ist ein Ort der Verwandlung, wo ein einfacher BÃ¼rger als Edelmann den Laden verlÃ¤sst. Jedes Rasieren wird zur Zeremonie, jeder Haarschnitt zum Kunstwerk, und selbst die leiseste BerÃ¼hrung wird zur Geste kultivierter Macht.</p>
<h3 data-heading="**Bart &amp; Klinge**"><strong>Bart &amp; Klinge</strong></h3>
<p><strong>Standort:</strong> Meilersgrund, im Viertel der Handwerker<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Eine rustikale Werkstatt mit Holzbalken und einem groÃŸen Kamin. Die AtmosphÃ¤re ist gemÃ¼tlich, und der Duft von KrÃ¤utern liegt in der Luft. An den WÃ¤nden hÃ¤ngen Zunftzeichen und alte Barbierwerkzeuge.<br>
<strong>Der Barbier:</strong> Gerwin Hartholz ist ein krÃ¤ftiger Mann mit wettergegerbter Haut und einem dichten Vollbart. Er ist bekannt fÃ¼r seine prÃ¤zisen Rasuren und seine FÃ¤higkeit, auch bei schwierigen Kunden ruhig zu bleiben.<br>
<strong>Angestellte:</strong> Zwei Gesellen helfen bei der Arbeit, wÃ¤hrend Gerwins Frau KrÃ¤uteraufgÃ¼sse fÃ¼r die Rasur vorbereitet. Ein Lehrling kÃ¼mmert sich um das AufrÃ¤umen und das SchÃ¤rfen der Klingen.<br>
<strong>Preise und QualitÃ¤t:</strong> Mittelpreisig mit solider QualitÃ¤t â€“ ideal fÃ¼r Handwerker und BÃ¼rger mittleren Standes.</p>
<h3 data-heading="**Rahjas Spiegel**"><strong>Rahjas Spiegel</strong></h3>
<p><strong>Standort:</strong> Neu-Gareth, nahe dem Rahja-Tempel<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Ein farbenfroher Salon mit seidenen VorhÃ¤ngen und duftenden Blumenarrangements. Die Einrichtung ist verspielt und romantisch, mit kunstvoll bemalten Spiegeln und weichen Polstern auf den StÃ¼hlen.<br>
<strong>Der Barbier:</strong> Lysandra von BlÃ¼tenhain ist eine charmante junge Frau mit einem Hang zur Extravaganz. Sie spezialisiert sich auf kunstvolle Flechtfrisuren und HaarfÃ¤rbungen in ungewÃ¶hnlichen Farben.<br>
<strong>Angestellte:</strong> Zwei Friseurinnen unterstÃ¼tzen Lysandra bei ihrer Arbeit, wÃ¤hrend ein Musiker leise Laute spielt, um die Kundschaft zu unterhalten.<br>
<strong>Preise und QualitÃ¤t:</strong> Oberer Mittelpreisbereich â€“ besonders beliebt bei KÃ¼nstlern, Schauspielern und wohlhabenden BÃ¼rgern.</p>
<h3 data-heading="**Der Rasierstein**"><strong>Der Rasierstein</strong></h3>
<p><strong>Standort:</strong> SÃ¼dquartier, nahe dem Viehmarkt<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Eine schlichte Werkstatt mit robusten HolzmÃ¶beln und einem groÃŸen Fenster zur StraÃŸe hin. Die Einrichtung ist funktional, aber sauber gehalten.<br>
<strong>Der Barbier:</strong> Borik Eisenbart ist ein Ã¤lterer Zwerg mit einer Vorliebe fÃ¼r klare Schnitte und praktische Frisuren. Er ist bekannt fÃ¼r seine Effizienz und seine robuste Art im Umgang mit Kunden.<br>
<strong>Angestellte:</strong> Keine â€“ Borik arbeitet allein, da er niemandem auÃŸer sich selbst vertraut, wenn es um das SchÃ¤rfen seiner Klingen geht.<br>
<strong>Preise und QualitÃ¤t:</strong> GÃ¼nstig mit guter QualitÃ¤t â€“ perfekt fÃ¼r einfache BÃ¼rger oder Reisende.</p>
<h3 data-heading="**Die Garether Schere**"><strong>Die Garether Schere</strong></h3>
<p><strong>Standort:</strong> Rosskuppel, im Viertel der HÃ¤ndler<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Ein moderner Salon mit groÃŸen Fenstern, durch die Sonnenlicht auf die polierten HolzfuÃŸbÃ¶den fÃ¤llt. Die Einrichtung kombiniert FunktionalitÃ¤t mit Stil; es gibt bequeme StÃ¼hle und eine kleine Bibliothek fÃ¼r wartende Kunden.<br>
<strong>Der Barbier:</strong> Roderick Feinhand ist ein junger Mann mit einem scharfen Auge fÃ¼r Details und einer Leidenschaft fÃ¼r neue Techniken. Er bietet auch Bartpflegeprodukte an, die er selbst herstellt.<br>
<strong>Angestellte:</strong> Eine Assistentin fÃ¼hrt Buch Ã¼ber Termine, wÃ¤hrend zwei Lehrlinge einfache Aufgaben Ã¼bernehmen wie das FÃ¶hnen oder das Reinigen der Werkzeuge.<br>
<strong>Preise und QualitÃ¤t:</strong> Moderat â€“ ideal fÃ¼r HÃ¤ndler oder BÃ¼rger mittleren Standes, die Wert auf Stil legen.</p>
<p>Diese Liste bietet eine Auswahl an Barbieren in Gareth, die verschiedene Stadtteile abdecken sowie unterschiedliche Preisklassen bedienen â€“ vom luxuriÃ¶sen Salon bis zur einfachen Werkstatt fÃ¼r den Alltagshandwerker oder Reisenden.</p>
<hr>

<h1 data-heading="Weitere LÃ¤den">Weitere LÃ¤den</h1>
<h3 data-heading="&quot;Hesindenspiegel&quot; - Intellektuelle Raffinesse">"Hesindenspiegel" - Intellektuelle Raffinesse</h3>
<p>In einem verschachtelten Fachwerkhaus nahe der Magierakademie findet sich "Hesindenspiegel". Die Fassade ist mit mathematischen und astrologischen Symbolen verziert.</p>
<p>Der Schneidermagier Theoban Sterndeuter, ein hagerer Mann mit funkelnden Augen, fÃ¼hrt das GeschÃ¤ft. Der Laden gleicht einer Bibliothek, mit BÃ¼cherregalen und magischen Artefakten zwischen den KleidungsstÃ¼cken.</p>
<p>"Hesindenspiegel" kreiert GewÃ¤nder fÃ¼r den intellektuellen Adel:</p>
<ul>
<li>Roben mit eingewebten, subtil leuchtenden Runen</li>
<li>UmhÃ¤nge, deren Muster sich je nach Lichteinfall in komplexe magische Diagramme verwandeln</li>
<li>Accessoires, die magische Effekte imitieren, wie Kragen, die einen Hauch von Sternenglanz verstrÃ¶men</li>
</ul>
<p>Diese Kleidung soll die TrÃ¤ger als Meister des Wissens und der arkanen KÃ¼nste prÃ¤sentieren.</p>
<h3 data-heading="Die KrÃ¤uterhandlung &quot;Zum Duftenden Alraun&quot;">Die KrÃ¤uterhandlung "Zum Duftenden Alraun"</h3>
<p>In einer verwinkelten Gasse des Hexenviertels von Havena liegt der Laden der KrÃ¤uterhexe Morla. Ein verwilderter Vorgarten voller seltsamer Pflanzen fÃ¼hrt zu einer schiefen HolztÃ¼r, Ã¼ber der ein ausgestopfter Rabe wacht. Der Innenraum ist ein Labyrinth aus Regalen, KÃ¶rben und von der Decke hÃ¤ngenden KrÃ¤uterbÃ¼ndeln.</p>
<p>Morla, eine alte Frau mit wildem grauem Haar und durchdringenden grÃ¼nen Augen, mustert jeden Kunden misstrauisch. Der Raum ist erfÃ¼llt vom Duft getrockneter KrÃ¤uter, exotischer GewÃ¼rze und mysteriÃ¶ser Essenzen. In GlÃ¤sern und Tiegeln finden sich seltene Ingredienzien: Drachenblut aus den Salamandersteine, Alraunenwurzeln aus dem Reichsforst und LotusblÃ¼ten aus den EchsensÃ¼mpfen.</p>
<p>FÃ¼r vertrauenswÃ¼rdige Kunden hÃ¤lt Morla besondere SchÃ¤tze bereit: TrÃ¤nke, die Visionen hervorrufen, Salben, die Wunden in Stunden heilen lassen, und Pulver, die angeblich Tote zum Leben erwecken kÃ¶nnen. Doch Vorsicht ist geboten - Morlas Waren sind mÃ¤chtig, aber oft mit unerwarteten Nebenwirkungen behaftet.</p>
<h3 data-heading="Die Schreibstube &quot;Zur Singenden Feder&quot;">Die Schreibstube "Zur Singenden Feder"</h3>
<p>In einem stillen Winkel des Hesindeviertels von Kuslik befindet sich die Schreibstube von Meister Fidelius. Ein zierlicher Turm aus weiÃŸem Marmor beherbergt den Laden, dessen Fenster mit buntem Glas verziert sind. Im Inneren herrscht eine AtmosphÃ¤re konzentrierter Stille, nur unterbrochen vom Kratzen der Federn auf Pergament.</p>
<p>Fidelius, ein hagerer Mann mit Nickelbrille und tintenbefleckten Fingern, empfÃ¤ngt Besucher mit einem zerstreuten LÃ¤cheln. Regale voller BÃ¼cher, Schriftrollen und Manuskripte sÃ¤umen die WÃ¤nde. Auf polierten Schreibpulten liegen Federn aus exotischen VÃ¶geln, TintenfÃ¤sser mit schimmernden Farben und Pergamente aus feinstem Kalbsleder.</p>
<p>FÃ¼r besondere Kunden bietet Fidelius auÃŸergewÃ¶hnliche Dienste an: Magische Tinte, die nur vom EmpfÃ¤nger gelesen werden kann, Pergamente, auf denen die Schrift von selbst erscheint, und BÃ¼cher, deren Inhalt sich dem Wissen des Lesers anpasst. Doch Vorsicht ist geboten - manche dieser magischen Schriften haben ein Eigenleben entwickelt und kÃ¶nnen unvorsichtige Leser in ihren Bann ziehen.</p>
<p>Gerne platziere ich die vier neuen LÃ¤den in Gareth und passe ihre Charakteristiken entsprechend an:</p>
<h3 data-heading="&quot;Schattenschneider&quot; - Diskrete Gewandungen im SÃ¼dquartier">"Schattenschneider" - Diskrete Gewandungen im SÃ¼dquartier</h3>
<p>Im SÃ¼dquartier Gareths, bekannt fÃ¼r seine verwinkelten Gassen und schattigen Ecken, verbirgt sich der Laden des "Schattenschneiders" hinter einer unscheinbaren Fassade. Ein kompliziertes System von Spiegeln und Schatten macht es fast unmÃ¶glich, den Eingang zu finden, wenn man nicht das richtige Losungswort kennt.</p>
<p>Der Besitzer, ein namenloser Schatten, der angeblich einst zur Garde des Kaisers gehÃ¶rte, kommuniziert nur durch geflÃ¼sterte Worte und subtile Gesten. Der Raum ist in ewiges Zwielicht getaucht, Ã¤hnlich den geheimen GÃ¤ngen des Kaiserpalastes.</p>
<p>Hier findet man Kleidung fÃ¼r jene, die in Gareth ungesehen bleiben wollen: UmhÃ¤nge, die jedes GerÃ¤usch der geschÃ¤ftigen StraÃŸen dÃ¤mpfen, Stiefel mit Sohlen, die keine Spuren auf den staubigen Pflastersteinen hinterlassen, und Masken, die das Gesicht des TrÃ¤gers den Schatten der Stadt anpassen.</p>
<p>FÃ¼r die Elite der Garether Unterwelt und diskrete Adlige bietet der Schattenschneider besondere Dienste: GewÃ¤nder, die es erlauben, durch die Schatten der PalÃ¤ste zu gleiten, Handschuhe, die jedes Siegel unbemerkt Ã¶ffnen, oder Kopfbedeckungen, die Gedanken vor den Magiern des Hofes verbergen.</p>
<h3 data-heading="&quot;Metamorphosenschneiderei&quot; - Verwandelnde Gewandungen im Magieviertel">"Metamorphosenschneiderei" - Verwandelnde Gewandungen im Magieviertel</h3>
<p>In einem schiefen Turm am Rande des Magierviertels von Gareth, nicht weit von der berÃ¼hmten Akademie der Magischen RÃ¼stung, befindet sich die "Metamorphosenschneiderei". Das GebÃ¤ude scheint sich dem Rhythmus der magischen Energien der Stadt anzupassen, und die TÃ¼r erscheint tÃ¤glich an einer anderen Stelle der Fassade.</p>
<p>Der Besitzer, der exzentrische Magier Zoltan von Gareth, ist ein Mann mit wildem Haar und Kleidung, die sich stÃ¤ndig in Farbe und Form verÃ¤ndert, passend zu den wechselnden Stimmungen der Kaiserstadt. In seinem Laden schweben Stoffe frei durch die Luft, und Kleider wechseln selbststÃ¤ndig ihre Gestalt, inspiriert von den magischen Experimenten der nahen Akademie.</p>
<p>Zoltan spezialisiert sich auf Kleidung, die sich den BedÃ¼rfnissen des hektischen Lebens in Gareth anpassen kann: MÃ¤ntel, die sich von formeller Hofkleidung in praktische ReisegewÃ¤nder verwandeln, Kleider, die ihre Farbe und ihren Schnitt je nach politischer Situation am Hof anpassen, oder HÃ¼te, die sich in Helme verwandeln kÃ¶nnen, sollte man in eine der berÃ¼chtigten Garether StraÃŸenschlÃ¤gereien geraten.</p>
<p>FÃ¼r besonders einflussreiche Kunden, wie hohe Beamte oder Mitglieder des Magierkollegiums, erschafft Zoltan Meisterwerke der Verwandlungskunst: GewÃ¤nder, die es dem TrÃ¤ger erlauben, sich unauffÃ¤llig durch verschiedene gesellschaftliche Schichten zu bewegen, Schuhe, die Treppen in den hÃ¶chsten TÃ¼rmen der Stadt mÃ¼helos erklimmen, oder Handschuhe, die jedes Dokument in eine fÃ¼r den TrÃ¤ger vorteilhafte Version verwandeln kÃ¶nnen.</p>
<p>Diese vier LÃ¤den bieten eine breite Palette an einzigartigen EinkleidungsmÃ¶glichkeiten, jeder perfekt an die komplexe politische, soziale und magische Landschaft Gareths angepasst.</p>
<h3 data-heading="&quot;Farbenzauber&quot; - StoffÃ¤rberei und Musterweberei">"Farbenzauber" - StoffÃ¤rberei und Musterweberei</h3>
<p>In einem bunten Fachwerkhaus am Ufer des GroÃŸen Flusses befindet sich "Farbenzauber". Der Laden ist von einem Garten umgeben, in dem seltene Pflanzen fÃ¼r Farbstoffe kultiviert werden.</p>
<p>Meisterin Iris Buntweberin, eine lebhafte Frau mit farbbefleckten HÃ¤nden und stets wechselnden Haarfarben, leitet das GeschÃ¤ft. Ihre Werkstatt ist ein Labyrinth aus FÃ¤rbebottichen, WebstÃ¼hlen und Trockengestellen.</p>
<p>Das Besondere an "Farbenzauber" ist Iris' FÃ¤higkeit, Stoffe zu fÃ¤rben, die ihre Farbe je nach Licht oder Stimmung des TrÃ¤gers Ã¤ndern kÃ¶nnen. Sie erreicht dies durch eine Kombination aus alchemistischen FÃ¤rbemitteln und feiner Illusionsmagie.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Iris einen Stoff, der tagsÃ¼ber in einem tiefen Blau schimmert, bei Kerzenlicht jedoch einen purpurnen Glanz annimmt. Das eingewebte Muster zeigt subtile Szenen aus der Geschichte des Adelshauses, die nur aus bestimmten Blickwinkeln sichtbar werden.</p>
<p>Der Auswahlprozess gleicht einer Farbberatung, bei der Iris nicht nur die Hautfarbe und Haarfarbe des Kunden berÃ¼cksichtigt, sondern auch dessen PersÃ¶nlichkeit und die gewÃ¼nschte Wirkung bei Hofe.</p>
<h3 data-heading="&quot;Glanzgestalt&quot; - Magische Kosmetik und ParfÃ¼merie">"Glanzgestalt" - Magische Kosmetik und ParfÃ¼merie</h3>
<p>In einem eleganten Stadthaus nahe des Hesindetempels findet sich "Glanzgestalt". Der Laden duftet nach exotischen Essenzen und schillert in allen Farben des Regenbogens.</p>
<p>Meister Lucius von Spiegel, ein gepflegter Mann mit hypnotisierenden Augen, fÃ¼hrt das GeschÃ¤ft mit der PrÃ¤zision eines Alchemisten. Sein Labor im Keller ist ein Wunderwerk aus Destillierapparaten und magischen Artefakten.</p>
<p>Die Einzigartigkeit von "Glanzgestalt" liegt in Lucius' FÃ¤higkeit, Kosmetika und DÃ¼fte zu kreieren, die nicht nur das Ã„uÃŸere, sondern auch die Aura des TrÃ¤gers verfeinern. Seine Kreationen kÃ¶nnen subtil die Wahrnehmung anderer beeinflussen oder sogar vor magischer Beeinflussung schÃ¼tzen.</p>
<p>FÃ¼r den Empfang empfiehlt Lucius ein maÃŸgeschneidertes ParfÃ¼m, das den natÃ¼rlichen Duft des TrÃ¤gers verstÃ¤rkt und gleichzeitig eine Aura von AutoritÃ¤t und VertrauenswÃ¼rdigkeit verstrÃ¶mt. Dazu eine Gesichtscreme, die feine Linien verschwinden lÃ¤sst und der Haut einen Ã¼bernatÃ¼rlichen Glanz verleiht.</p>
<p>Die Anpassung der Produkte ist ein intimer Prozess, bei dem Lucius nicht nur die Haut und den KÃ¶rpergeruch analysiert, sondern auch die PersÃ¶nlichkeit und die Ziele des Kunden berÃ¼cksichtigt.</p>
<h3 data-heading="&quot;Federkiel &amp; Tinte&quot; - Kalligraphie und Siegelkunst">"Federkiel &amp; Tinte" - Kalligraphie und Siegelkunst</h3>
<p>In einem schmalen Turm im Gelehrtenviertel residiert "Federkiel &amp; Tinte". Der Laden ist ein Paradies fÃ¼r Schreibkundige, mit Regalen voller Schreibfedern, Tinten in allen Farben und edlen Papieren.</p>
<p>Meisterin Serena SchÃ¶nschrift, eine zierliche Frau mit tintenbefleckten Fingern und scharfen Augen, fÃ¼hrt das GeschÃ¤ft mit der PrÃ¤zision einer Uhrmacherin. Ihre Werkstatt im obersten Stockwerk bietet einen atemberaubenden Blick Ã¼ber Gareth.</p>
<p>Das Besondere an "Federkiel &amp; Tinte" ist Serenas FÃ¤higkeit, magische Siegel und Unterschriften zu kreieren, die nicht gefÃ¤lscht werden kÃ¶nnen und sogar versteckte Botschaften enthalten kÃ¶nnen. Sie kombiniert traditionelle Kalligraphie mit feiner Runenzauberei.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Serena ein personalisiertes Siegel vor, das nicht nur das Wappen des Adelshauses zeigt, sondern auch subtil die Tugenden des TrÃ¤gers symbolisiert. Dazu eine Tinte, die auf normalem Papier schwarz erscheint, auf speziell prÃ¤pariertem Papier jedoch in den Hausfarben schimmert.</p>
<p>Die Erstellung des Siegels und der Tinte ist ein langwieriger Prozess, bei dem Serena die Familiengeschichte, persÃ¶nliche Errungenschaften und zukÃ¼nftige Ambitionen des Kunden in ihr Design einflieÃŸen lÃ¤sst.</p>
<h3 data-heading="&quot;Zeitlose Eleganz&quot; - Uhrmacherei und magische Zeitmesser">"Zeitlose Eleganz" - Uhrmacherei und magische Zeitmesser</h3>
<p>In einem Uhrenturm am Rande des Magierviertels befindet sich "Zeitlose Eleganz". Der Laden ist erfÃ¼llt vom sanften Ticken unzÃ¤hliger Uhren und dem Glitzern feinster Mechanismen.</p>
<p>Meister Chronos von Stundenglas, ein Mann mit silbernem Haar und stets prÃ¤zisen Bewegungen, leitet das GeschÃ¤ft mit der Genauigkeit seiner Uhren. Seine Werkstatt im obersten Stockwerk des Turms ist ein Wunderwerk der Feinmechanik und magischen Zeitmessung.</p>
<p>Die Einzigartigkeit von "Zeitlose Eleganz" liegt in Chronos' FÃ¤higkeit, Uhren zu erschaffen, die mehr als nur die Zeit anzeigen. Seine Kreationen kÃ¶nnen gÃ¼nstige Zeitpunkte fÃ¼r wichtige Entscheidungen anzeigen, vor Gefahren warnen oder sogar kurzfristig die Zeit fÃ¼r den TrÃ¤ger verlangsamen.</p>
<p>FÃ¼r den Empfang empfiehlt Chronos eine Taschenuhr aus Mithril, deren Zifferblatt die Sternenkonstellation zum Zeitpunkt der Geburt des TrÃ¤gers zeigt. Die Uhr kann nicht nur die genaue Zeit, sondern auch die Stimmung im Raum und die Aufrichtigkeit von GesprÃ¤chspartnern anzeigen.</p>
<p>Die Anfertigung einer solchen Uhr ist ein komplexer Prozess, der Wochen dauern kann und bei dem Chronos nicht nur die technischen Aspekte, sondern auch die astrologischen und persÃ¶nlichen Faktoren des Kunden berÃ¼cksichtigt.</p>
<h3 data-heading="&quot;Spiegelbild&quot; - Magische Spiegel und Illusionskunst">"Spiegelbild" - Magische Spiegel und Illusionskunst</h3>
<p>In einem schimmernden Kristallpalast im Herzen des Magierviertels befindet sich "Spiegelbild". Der Laden selbst scheint aus Tausenden von Spiegeln zu bestehen, die das Licht in faszinierenden Mustern reflektieren.</p>
<p>Meisterin Luna Silberblick, eine Ã¤therische Erscheinung mit silbernen Augen, fÃ¼hrt das GeschÃ¤ft mit der Anmut einer TÃ¤nzerin. Ihr Atelier im Zentrum des Kristallpalastes ist ein Kaleidoskop aus Licht und Illusion.</p>
<p>Das Besondere an "Spiegelbild" ist Lunas FÃ¤higkeit, Spiegel zu erschaffen, die mehr zeigen als nur das Spiegelbild. Ihre Kreationen kÃ¶nnen vergangene oder zukÃ¼nftige Versionen des Betrachters zeigen, verborgene Wahrheiten enthÃ¼llen oder sogar als Portale zu anderen Orten dienen.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Luna einen Handspiegel vor, der dem TrÃ¤ger stets sein bestes Selbst zeigt und subtile Hinweise gibt, wie dieses Ideal erreicht werden kann. ZusÃ¤tzlich bietet sie eine Brosche mit einem winzigen Spiegel an, der vor feindseligen Absichten in der Umgebung warnt.</p>
<p>Die Erschaffung dieser magischen Spiegel ist ein faszinierender Prozess, bei dem Luna nicht nur die physische Erscheinung des Kunden studiert, sondern auch tief in dessen Seele blickt, um die wahren WÃ¼nsche und Ã„ngste zu erkennen.</p>
<h3 data-heading="&quot;Klangweber&quot; - Magische Musikinstrumente und Klangzauber">"Klangweber" - Magische Musikinstrumente und Klangzauber</h3>
<p>In einem melodisch summenden Turm am Rande des KÃ¼nstlerviertels befindet sich "Klangweber". Der Laden ist erfÃ¼llt von sanfter Musik, die aus unsichtbaren Quellen zu kommen scheint.</p>
<p>Meister Harmonius Wohlklang, ein Mann mit einem LÃ¤cheln so warm wie Sonnenschein und Fingern so flink wie KolibriflÃ¼gel, leitet das GeschÃ¤ft. Seine Werkstatt im obersten Stockwerk ist ein Symphonie aus Instrumenten, Klangschalen und vibrierenden Kristallen.</p>
<p>Die Einzigartigkeit von "Klangweber" liegt in Harmonius' FÃ¤higkeit, Instrumente zu erschaffen, die nicht nur Musik spielen, sondern auch Emotionen beeinflussen oder sogar subtile Magie wirken kÃ¶nnen. Seine Kreationen kÃ¶nnen RÃ¤ume mit positiver Energie fÃ¼llen, LÃ¼gen entlarven oder sogar kleine Wunder bewirken.</p>
<p>FÃ¼r den Empfang empfiehlt Harmonius eine FlÃ¶te aus Mondholz, die, wenn gespielt, eine Aura der Gelassenheit und des Wohlwollens verbreitet. ZusÃ¤tzlich bietet er eine Stimmgabel an, die, wenn angeschlagen, disharmonische Energien in der Umgebung neutralisieren kann.</p>
<p>Die Erschaffung dieser magischen Instrumente ist ein langwieriger Prozess, bei dem Harmonius nicht nur die musikalischen FÃ¤higkeiten des Kunden berÃ¼cksichtigt, sondern auch dessen emotionale Landschaft und spirituelle Resonanz.</p>
<h3 data-heading="&quot;Schattenschneider&quot; - Magische Beleuchtung und Schattenkunst">"Schattenschneider" - Magische Beleuchtung und Schattenkunst</h3>
<p>In einem dÃ¼steren, aber eleganten GebÃ¤ude nahe des Phex-Tempels befindet sich "Schattenschneider". Der Laden ist ein faszinierendes Spiel aus Licht und Schatten, wo Dunkelheit und Helligkeit in perfekter Harmonie zu existieren scheinen.</p>
<p>Meisterin Umbra Nachtkind, eine schlanke Frau mit rabenschwarzen Haaren und Augen, die im Dunkeln zu leuchten scheinen, fÃ¼hrt das GeschÃ¤ft. Ihr Atelier im Keller ist ein Labyrinth aus Lichtquellen, Schattenformen und optischen Illusionen.</p>
<p>Das Besondere an "Schattenschneider" ist Umbras FÃ¤higkeit, Beleuchtung und Schatten zu manipulieren, um subtile magische Effekte zu erzielen. Ihre Kreationen kÃ¶nnen RÃ¤ume grÃ¶ÃŸer erscheinen lassen, unerwÃ¼nschte Aufmerksamkeit ablenken oder sogar Botschaften in Schatten verbergen.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Umbra eine Brosche vor, die das Licht um den TrÃ¤ger herum so manipuliert, dass er stets im besten Licht erscheint. ZusÃ¤tzlich bietet sie einen SchattenfÃ¤cher an, der bei Bedarf einen Bereich der PrivatsphÃ¤re um den Benutzer herum erzeugen kann.</p>
<p>Die Erschaffung dieser Licht- und Schattenartefakte ist ein faszinierender Prozess, bei dem Umbra nicht nur die physische Erscheinung des Kunden studiert, sondern auch dessen PersÃ¶nlichkeit und die gewÃ¼nschte Wirkung in verschiedenen sozialen Situationen berÃ¼cksichtigt.</p>
<p>Jeder dieser LÃ¤den bietet nicht nur auÃŸergewÃ¶hnliche Waren, sondern auch ein einzigartiges Einkaufserlebnis, das den Besuch zu einem unvergesslichen Teil der Vorbereitung auf den festlichen Empfang macht. Die Meister ihres Fachs verstehen es, die BedÃ¼rfnisse und den Status ihrer adligen Kundschaft zu wÃ¼rdigen und zu bedienen, wodurch jedes erworbene StÃ¼ck zu einem wahren Kunstwerk mit magischer Raffinesse wird.</p>
<h1 data-heading="Weitere LÃ¤den aus ChatGPT">Weitere LÃ¤den aus ChatGPT</h1>
<h3 data-heading="1. **â€žDer Goldene Fadenâ€œ â€“ GewÃ¤nder fÃ¼r den Hof**">1. <strong>â€žDer Goldene Fadenâ€œ â€“ GewÃ¤nder fÃ¼r den Hof</strong></h3>
<p>In einer ruhigen Seitengasse des Adelsviertels von Gareth befindet sich â€žDer Goldene Fadenâ€œ, ein exklusives Modehaus, das fÃ¼r seine meisterhaft gefertigten GewÃ¤nder bekannt ist. Die Fassade des GebÃ¤udes ist mit kunstvollen Schnitzereien verziert, die Szenen aus der Geschichte des Mittelreichs darstellen. GroÃŸe Fenster erlauben Passanten einen Blick auf die prÃ¤chtigen Stoffe und KleidungsstÃ¼cke im Inneren.</p>
<p>Beim Betreten des Ladens wird man von einem dezenten Duft nach Lavendel und feinem ParfÃ¼m empfangen. Die InnenrÃ¤ume sind mit edlen HÃ¶lzern vertÃ¤felt, und Kronleuchter aus Kristall werfen ein warmes Licht auf die ausgestellten KleidungsstÃ¼cke. Auf goldenen StÃ¤ndern hÃ¤ngen Roben aus Seide, Brokat und Samt, verziert mit Stickereien und Edelsteinen.</p>
<p><strong>Besitzerin:</strong> <em>Madame Elenora von Arkenstein</em> ist eine elegante Dame mittleren Alters mit silbernem Haar, das zu einem kunstvollen Knoten frisiert ist. Sie trÃ¤gt stets ein maÃŸgeschneidertes Kleid aus dunkelblauem Samt, das ihre schlanke Figur betont. Ihre Augen sind von einem intensiven GrÃ¼n, und ihr Auftreten ist von einer natÃ¼rlichen AutoritÃ¤t geprÃ¤gt.</p>
<p><strong>Angestellte:</strong> <em>Lina</em>, eine junge Schneiderin mit flinken Fingern, ist fÃ¼r die Anfertigung der GewÃ¤nder zustÃ¤ndig. Sie trÃ¤gt praktische Kleidung, die mit Nadelkissen und MaÃŸbÃ¤ndern ausgestattet ist. <em>Gregor</em>, ein Ã¤lterer Herr mit grauem Bart, berÃ¤t die Kunden mit seiner ruhigen und kompetenten Art.</p>

<hr>
<h3 data-heading="2. **â€žSchritt &amp; Trittâ€œ â€“ MaÃŸgeschneidertes Schuhwerk**">2. <strong>â€žSchritt &amp; Trittâ€œ â€“ MaÃŸgeschneidertes Schuhwerk</strong></h3>
<p>In der NÃ¤he des Marktplatzes liegt â€žSchritt &amp; Trittâ€œ, ein Schuhmacherbetrieb, der fÃ¼r seine maÃŸgeschneiderten Schuhe bekannt ist. Die AuÃŸenfassade ist schlicht, doch ein kunstvoll geschnitztes Holzschild mit einem stilisierten Schuh weist auf die QualitÃ¤t des Handwerks hin.</p>
<p>Im Inneren des Ladens riecht es nach Leder und Politur. Regale aus dunklem Holz prÃ¤sentieren eine Auswahl an Schuhen, von robusten Stiefeln bis zu eleganten Pantoffeln. Ein groÃŸer Arbeitstisch mit Werkzeugen und LederstÃ¼cken zeugt von der handwerklichen TÃ¤tigkeit.</p>
<p><strong>Besitzer:</strong> <em>Meister Alrik EisenfuÃŸ</em> ist ein krÃ¤ftiger Mann mit wettergegerbter Haut und einem dichten, braunen Bart. Er trÃ¤gt eine LederschÃ¼rze Ã¼ber seiner einfachen Kleidung und spricht mit einer tiefen, beruhigenden Stimme. Seine HÃ¤nde sind rau, doch geschickt, und seine Augen strahlen Stolz auf sein Handwerk aus.</p>
<p><strong>Angestellte:</strong> <em>Tilda</em>, eine junge Frau mit kurzem, lockigem Haar, ist fÃ¼r die Anprobe und Anpassung der Schuhe zustÃ¤ndig. Sie trÃ¤gt praktische Kleidung und ist stets freundlich und hilfsbereit. <em>Jorin</em>, ein stiller Geselle, arbeitet konzentriert an der Fertigung neuer Modelle.</p>
<hr>
<h3 data-heading="3. **â€žDie Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den Adel**">3. <strong>â€žDie Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den Adel</strong></h3>
<p>In einer belebten StraÃŸe nahe der Stadtmauer befindet sich â€žDie Klingenschmiedeâ€œ, ein WaffengeschÃ¤ft, das sich auf die Herstellung von hochwertigen Klingen spezialisiert hat. Die Fassade ist mit Metallverzierungen geschmÃ¼ckt, und ein groÃŸes Schild mit einem stilisierten Schwert weist auf das Angebot hin.</p>
<p>Beim Betreten des Ladens hÃ¶rt man das rhythmische HÃ¤mmern aus der Schmiede im Hinterhof. Vitrinen prÃ¤sentieren kunstvoll gearbeitete Schwerter, Dolche und Rapiere, deren Klingen im Licht glÃ¤nzen. RÃ¼stungen und Schilde hÃ¤ngen an den WÃ¤nden, und ein Geruch nach Metall und SchmierÃ¶l liegt in der Luft.</p>
<p><strong>Besitzer:</strong> <em>Meisterin Brynja Stahlherz</em> ist eine hochgewachsene Frau mit muskulÃ¶sem KÃ¶rperbau und kurzem, rotem Haar. Sie trÃ¤gt eine schlichte Lederkleidung, die ihre Bewegungsfreiheit nicht einschrÃ¤nkt. Ihre Stimme ist krÃ¤ftig, und sie spricht mit einem nordischen Akzent.</p>
<p><strong>Angestellte:</strong> <em>Falk</em>, ein junger Schmiedegeselle mit ruÃŸverschmiertem Gesicht, arbeitet unter Brynjas Anleitung an neuen Klingen. <em>Mira</em>, eine erfahrene Waffenschmiedin, ist fÃ¼r die Gravuren und Verzierungen zustÃ¤ndig und trÃ¤gt stets eine Schutzbrille und Handschuhe.</p>
<hr>
<h3 data-heading="4. **â€žDer Edle Schnittâ€œ â€“ Barbier fÃ¼r gehobene AnsprÃ¼che**">4. <strong>â€žDer Edle Schnittâ€œ â€“ Barbier fÃ¼r gehobene AnsprÃ¼che</strong></h3>
<p>Im Herzen der Altstadt von Gareth, zwischen Marmorstatuen und kleinen Springbrunnen, steht ein Haus mit einem rot-weiÃŸ gestreiften Schild Ã¼ber dem Eingang. Der Laden trÃ¤gt den klangvollen Namen â€žDer Edle Schnittâ€œ und gilt unter Kennern als der Ort, an dem Haar, Bart und Haut mit hÃ¶chster Sorgfalt gepflegt werden.</p>
<p>Der Eingangsbereich gleicht mehr einem Salon als einem Handwerksbetrieb: vergoldete Spiegel an den WÃ¤nden, weiche StÃ¼hle aus Mahagoni mit tiefgrÃ¼ner Polsterung und kleine Kristallleuchter, die ein warmes, sanftes Licht spenden. Der Innenraum ist erfÃ¼llt vom Duft edler Pomaden, ZedernÃ¶l und feinen Rasierseifen. Instrumente aus Silber und Messing glÃ¤nzen ordentlich aufgereiht auf dunklen Ablagen.</p>
<p><strong>Besitzer:</strong> <em>Barbier Amando Calvero</em> ist der unangefochtene Herr Ã¼ber Schere und Klinge. Von mittlerer GrÃ¶ÃŸe, mit olivfarbener Haut, fein geschwungenem Bart und dunklen, klugen Augen, bewegt er sich mit einer Eleganz, als tanze er durch seinen Laden. Sein Haar ist zu einem perfekten Knoten hochgebunden, ein Seidenband in Purpur hÃ¤lt es in Form. Er trÃ¤gt eine taillierte schwarze Weste mit goldener Stickerei, ein weiÃŸes Hemd mit RÃ¼schenmanschetten und ein langes, schimmerndes Halstuch in Mitternachtsblau.</p>
<p><strong>Angestellte:</strong> <em>Serafin</em>, ein schlaksiger, junger Mann mit blassem Teint und hellblonden Locken, ist fÃ¼r Ordnung, Duftmischungen und Haarpflegeprodukte zustÃ¤ndig. Er trÃ¤gt ein blassviolettes Arbeitsgewand mit seidigem Glanz und spricht stets hÃ¶flich, fast unterwÃ¼rfig. <em>Lysandra</em>, eine rothaarige, energische Gesellin, versteht sich auf Damenfrisuren und ParfÃ¼merie. Sie trÃ¤gt ein elegantes, aber praktisches Kleid mit SpitzenschÃ¼rze, stets parfÃ¼miert mit Lavendel.</p>
<h3 data-heading="**6. â€žJuwelen der MorgenrÃ¶teâ€œ â€“ Schmuck fÃ¼r die Hohe Gesellschaft**"><strong>6. â€žJuwelen der MorgenrÃ¶teâ€œ â€“ Schmuck fÃ¼r die Hohe Gesellschaft</strong></h3>
<p>Zwischen edlen StadthÃ¤usern und verwinkelten Pflastergassen erhebt sich ein prÃ¤chtiges GebÃ¤ude mit kunstvoll verzierten Fenstern und einem auf Hochglanz polierten Schild aus Messing, das in verschnÃ¶rkelten Lettern den Namen â€žJuwelen der MorgenrÃ¶teâ€œ trÃ¤gt. Schon von auÃŸen glÃ¤nzen Edelsteine in Schauvitrinen und locken jene an, die nach exquisiten Kostbarkeiten suchen.</p>
<p>Der Innenraum ist eine Oase aus Glanz und Luxus. Samtene VorhÃ¤nge in dunklem Rot rahmen die Fenster, der Boden ist mit weichen Teppichen aus tulamidischer Webkunst bedeckt. Auf feingeschliffenen Tischen aus Glas und Mahagoni liegen Samtkissen, auf denen filigran gearbeitete SchmuckstÃ¼cke prÃ¤sentiert werden. Ein zartes Glockenspiel erklingt beim Betreten des Ladens, und der Duft von Myrrhe und Sandelholz liegt in der Luft.</p>
<p><strong>Besitzerin:</strong> <em>Madame Cyraleine von Teshkal</em>, eine Dame in den FÃ¼nfzigern mit schneeweiÃŸem Haar, trÃ¤gt stets einen langen violetten Mantel Ã¼ber einer edlen Brokatrobe. Ihre Haut ist makellos, ihre Bewegungen anmutig und ihr Blick durchdringend. Um ihren Hals hÃ¤ngt ein feines Collier aus blauen Saphiren, das sie selbst entworfen hat. Ihre goldenen Ringe sind mit Edelsteinen in kunstvollen Fassungen verziert, jeder ein Meisterwerk.</p>
<p><strong>SchmuckstÃ¼cke:</strong><br>
Die Kollektion umfasst Diademe aus WeiÃŸgold, in denen Amethyste wie Sterne gefasst sind. Ohrringe mit funkelnden Smaragden, deren Fassungen in Form stilisierter EfeublÃ¤tter gearbeitet sind. Ringe, deren Steine aus den Minen von Angbar stammen, eingefasst in filigrane Gravuren, die Geschichten alter Heldensagen erzÃ¤hlen.<br>
Ein besonders begehrtes StÃ¼ck ist ein Armband aus sieben verschiedenen Edelsteinen, die jeweils einen der ZwÃ¶lfgÃ¶tter symbolisieren â€“ vom goldgelben Topas fÃ¼r Praios bis zum tiefschwarzen Onyx fÃ¼r Boron.<br>
Zarte Halsketten aus Mondstein, die bei Kerzenschein schimmern, sowie Haarnadeln aus Silber mit eingravierten Elfenmustern runden das Sortiment ab. Viele der StÃ¼cke kÃ¶nnen personalisiert oder mit magischen Runen versehen werden â€“ fÃ¼r jene Kunden, die sich auch mystische Schutzwirkungen wÃ¼nschen.</p>
<p><strong>Angestellte:</strong> <em>Arenio</em>, ein junger Goldschmied mit ruhigem Auftreten, trÃ¤gt eine schlichte graue Tunika und eine Lupenbrille auf der Stirn. Er arbeitet hinter einer Glasscheibe an einem fein beleuchteten Werktisch und fÃ¼hrt mit geschickten HÃ¤nden Gravuren aus. <em>Lisanne</em>, eine charmante HÃ¤ndlerin, mit kastanienbraunem Haar und bernsteinfarbenen Augen, ist fÃ¼r den Verkauf zustÃ¤ndig. Sie trÃ¤gt selbst stets ein paar StÃ¼cke aus dem Sortiment â€“ zur Demonstration â€“ und spricht mit viel Wissen Ã¼ber Herkunft, Symbolik und Verarbeitung der Juwelen.</p>
<hr>
<h3 data-heading="**7. â€žEssenz der SphÃ¤renâ€œ â€“ ParfÃ¼merie und Duftkunst**"><strong>7. â€žEssenz der SphÃ¤renâ€œ â€“ ParfÃ¼merie und Duftkunst</strong></h3>
<p>Ein zierliches GebÃ¤ude mit einer blauen Kachelverzierung an der AuÃŸenwand beherbergt die â€žEssenz der SphÃ¤renâ€œ, eine ParfÃ¼merie, wie sie kein zweites Mal in Gareth zu finden ist. Der Eingang ist flankiert von zwei bronzenen Statuen, die elegante Frauengestalten mit Duftflakons darstellen. Beim Betreten des GeschÃ¤fts wird man in ein Reich der Sinne entfÃ¼hrt.</p>
<p>Die Luft ist durchtrÃ¤nkt von floralen, wÃ¼rzigen und harzigen Aromen, die in wechselnden Nuancen durch den Raum gleiten. Feine GlasflÃ¤schchen, kunstvoll geblasen und mit goldenen oder silbernen VerschlÃ¼ssen versehen, stehen ordentlich auf Regalen aus Zedernholz. Ein leises PlÃ¤tschern aus einem kleinen Duftbrunnen begleitet das sanfte Klingen von KristallanhÃ¤ngern, die vom Fenster baumeln.</p>
<p><strong>Besitzer:</strong> <em>Herr Aurelian Duftwacht</em>, ein schlanker Mann mit schwarzem Haar und spitzen GesichtszÃ¼gen, ist ParfÃ¼meur mit Leib und Seele. Er trÃ¤gt stets einen langen, cremefarbenen Kittel mit goldenen KnÃ¶pfen und einen Duftstein an einer Kette um den Hals. Sein gepflegter Bart ist dezent mit Ã–len behandelt, und seine Stimme klingt wie das FlÃ¼stern von Seide. Man munkelt, er kÃ¶nne allein durch Geruch die Herkunft eines Menschen erkennen.</p>
<p><strong>ParfÃ¼ms:</strong><br>
Im Angebot finden sich sowohl klassische als auch exotische DÃ¼fte.<br>
â€žMorgenhauchâ€œ â€“ ein leichter Duft mit Noten von Taurose, Veilchenblatt und einem Hauch von Minze, perfekt fÃ¼r EmpfÃ¤nge bei Sonnenaufgang.<br>
â€žFeuerherzâ€œ â€“ eine krÃ¤ftige Essenz aus Bernstein, Zimt, dunklem Harz und einem Hauch Moschus, bevorzugt von KÃ¤mpferinnen und Adeligen mit PrÃ¤senz.<br>
â€žWÃ¼stenwindâ€œ â€“ mit Oud, Myrrhe, Safran und getrockneter Feige, erinnert an tulamidische NÃ¤chte unter Sternenzelten.<br>
â€žSphÃ¤renklangâ€œ â€“ ein magischer Duft, hergestellt mit einem Tropfen EinhorntrÃ¤ne und LavendelgeiÃŸblatt, der angeblich Klarheit im Traum bringt.<br>
Alle ParfÃ¼ms werden auf Wunsch auch als DuftÃ¶le oder Salben abgefÃ¼llt, manche sogar mit alchimistischer Wirkung â€“ etwa um NervositÃ¤t zu lindern, MÃ¼digkeit zu vertreiben oder Romantik zu entfachen.</p>
<p><strong>Angestellte:</strong> <em>Mirjam</em>, eine Ã¤ltere Dame mit feinem Geruchssinn, leitet die Duftproben und berÃ¤t individuell, welcher Duft zur PersÃ¶nlichkeit passt. Ihre Kleidung ist elegant, aber schlicht â€“ ein lavendelfarbener Umhang mit goldbesticktem Kragen. <em>Kelian</em>, ein junger Novize aus Punin, hilft bei der Herstellung und ist spezialisiert auf das Destillieren seltener Pflanzenessenzen. Sein Gewand ist von Flecken aromatischer Ã–le durchzogen, und seine HÃ¤nde duften selbst dann nach Jasmin, wenn er schlÃ¤ft.</p>
<h1 data-heading="Spielmodule">Spielmodule</h1>
<h2 data-heading="ðŸª™ **Juwelen der MorgenrÃ¶te (Schmuckladen, gehoben)**">ðŸª™ <strong>Juwelen der MorgenrÃ¶te (Schmuckladen, gehoben)</strong></h2>
<p><strong>Ort:</strong> Oberstadt von Gareth<br>
<strong>Kategorie:</strong> LuxusgeschÃ¤ft (Schmuck, Juwelen, besondere EinzelstÃ¼cke)</p>
<hr>
<h3 data-heading="**NSCs**"><strong>NSCs</strong></h3>
<p><strong>ðŸ§• Madame Cyraleine von Teshkal (Besitzerin):</strong></p>
<ul>
<li><em>Typ:</em> Adelige Goldschmiedin<br>
</li>
<li><em>Professionelle Eigenschaften:</em> Handwerk (Goldschmiedekunst) 15, Etikette 14, Menschenkenntnis 13<br>
</li>
<li><em>Auftreten:</em> Ruhig, kultiviert, kennt sich mit den modischen Vorlieben der Adligen aus. Hat beste Kontakte zum Hof.<br>
</li>
<li><em>Geheimnis:</em> War einst Hofjuwelierin einer tulamidischen Prinzessin.<br>
</li>
</ul>
<p><strong>ðŸ‘¨ Arenio (Schmied):</strong></p>
<ul>
<li><em>Typ:</em> Handwerkerlehrling mit Talent<br>
</li>
<li><em>Eigenschaften:</em> Handwerk (Feinmechanik, Gravur) 11, Fingerfertigkeit 13<br>
</li>
<li><em>Besonderheit:</em> Still, aber leidenschaftlich â€“ kÃ¶nnte in ein Abenteuer Ã¼ber magische Runenringe verwickelt sein.<br>
</li>
</ul>
<p><strong>ðŸ‘© Lisanne (Verkauf):</strong></p>
<ul>
<li><em>Typ:</em> Charismatische HÃ¤ndlerin<br>
</li>
<li><em>Eigenschaften:</em> Ãœberreden 14, Etikette 13, Gassenwissen 11<br>
</li>
<li><em>StÃ¤rke:</em> Kann Kundschaft gut einschÃ¤tzen und ist charmant-direkt.<br>
</li>
</ul>
`

const TEST_HTML3 =
`
<details  data-callout="example" class="callout"><summary><span>KI Prompt </span></summary><div>
<p>Ich benÃ¶tige die Beschreibung von vier LÃ¤den wie sie sich im Mittelalter oder der renesaince dargestellt haben mÃ¶gen die einen edlen mit Kleidung, Schuhen und Waffen ausgestattet haben kÃ¶nnten so dass er zu einem festlichen Empfang geht. Die Beschreibungen der LÃ¤den der Waren und des VerkÃ¤ufers sollen detailliert sein und mindestens 50 SÃ¤tze umfassen.</p>
<p>Bitte erstelle mir eine Liste von 5 Barbieren die in Gareth beheimatet sind inklusive einer Beschreibung ihres Arbeitsplatzes, des Barbiers und seiner angestellten. Stufe die Barbiere ab in Preis und QualitÃ¤t und beachte das es sich um ein mittelalterliches bzw. rokkoko setting handelt. Verwende mindestens 20 SÃ¤tze pro Barbier</p>
<h4 data-heading="ChatGPT">ChatGPT</h4>
<p>Erstelle eine immersive, atmosphÃ¤rische Beschreibung eines Ladens, wie er in einer mittelalterlichen oder frÃ¼hneuzeitlichen (Renaissance-/Rokoko-inspirierten) Stadt wie Gareth aus dem Rollenspielsystem <em>Das Schwarze Auge</em> (DSA5) existieren kÃ¶nnte. Der Laden soll fÃ¼r wohlhabende Kunden (Adlige, Gelehrte, hochgestellte BÃ¼rger) hochwertige Waren anbieten â€“ z.â€¯B. Kleidung, Schuhe, Waffen oder KÃ¶rperpflege.</p>
<p>Die Beschreibung soll mindestens 50 SÃ¤tze umfassen und sowohl den Aufbau und das Innere des Ladens als auch die ausgestellten Waren, GerÃ¼che, LichtverhÃ¤ltnisse und AtmosphÃ¤re beschreiben. ZusÃ¤tzlich sollen der Ladenbesitzer sowie seine Angestellten detailliert dargestellt werden, inklusive ihrer Rolle, PersÃ¶nlichkeit, Kleidung und Ã¤uÃŸeren Erscheinung.</p>
<p>Bitte beachte:</p>
<ul>
<li>Verwende eine bildhafte, lebendige Sprache.</li>
<li>Der Stil soll an literarische Beschreibungen erinnern â€“ wie aus einem atmosphÃ¤rischen Roman.</li>
<li>Die Zeit ist an das spÃ¤te Mittelalter oder Rokoko angelehnt â€“ mit Magie- oder Fantasyelementen, wie sie in DSA5 vorkommen kÃ¶nnen.</li>
<li>Kleidung, Interieur und Umgangsformen sollen der gesellschaftlichen Schicht angepasst sein (von fein bis rustikal).</li>
<li>Achte auf AuthentizitÃ¤t im Stil (z.â€¯B. keine modernen Begriffe oder Technologien).</li>
<li>ErgÃ¤nze fÃ¼r jede Person (Besitzer/in, Angestellte) 3â€“5 zusÃ¤tzliche SÃ¤tze zur Beschreibung ihres Aussehens und ihrer Kleidung.</li>
</ul>
</div><div></div></details>
<pre><code>Erstelle eine stimmungsvolle<span>,</span> detailreiche Beschreibung eines Ladens <span>in</span> einer stÃ¤dtischen Umgebung der _DSA5_<span>-</span>Welt<span>,</span> vorzugsweise <span>in</span> Gareth oder einer Ã¤hnlich groÃŸen Stadt<span>.</span> Der Laden soll hochqualitative Waren fÃ¼r wohlhabende Kundschaft anbieten â€“ etwa Kleidung<span>,</span> Schuhe<span>,</span> Waffen oder KÃ¶rperpflegeartikel â€“<span>,</span> mit besonderem Fokus auf Produkte fÃ¼r festliche AnlÃ¤sse oder <span>repr</span>Ã¤sentative Zwecke<span>.</span> Die Zeit ist an das spÃ¤te Mittelalter bis Rokoko angelehnt<span>,</span> inklusive fantasievoller und magischer Elemente<span>,</span> wie sie im Aventurien<span>-</span>Setting Ã¼blich sind<span>.</span>
Die Beschreibung soll mindestens <span>**</span><span>50</span> vollstÃ¤ndige SÃ¤tze<span>**</span> umfassen und folgende Aspekte umfassen<span>:</span>
<span>**</span><span>1.</span> Die Ã¤uÃŸere Erscheinung des Ladens<span>:</span><span>**</span>
<span>-</span> GebÃ¤udeart<span>,</span> Standort <span>in</span> der Stadt <span>(</span>z<span>.</span>â€¯B<span>.</span> NÃ¤he zum Markt<span>,</span> Adelsviertel etc<span>.</span><span>)</span><span>,</span> Schild<span>,</span> Fenster<span>,</span> Geruch und GerÃ¤uschkulisse drauÃŸen<span>.</span>
<span>**</span><span>2.</span> Das Innere des Ladens<span>:</span><span>**</span>
<span>-</span> Einrichtung<span>,</span> Materialien<span>,</span> Dekor<span>,</span> Lichtquellen<span>,</span> GerÃ¼che<span>,</span> AtmosphÃ¤re<span>,</span> GerÃ¤usche<span>,</span> eventuell magische Effekte<span>.</span>
<span>-</span> WarenprÃ¤sentation <span>(</span>Schaufenster<span>,</span> Regale<span>,</span> Tische<span>,</span> Vitrinen<span>)</span><span>,</span> Produktauswahl<span>,</span> Preisspanne<span>.</span>
<span>**</span><span>3.</span> Die Besitzerperson<span>:</span><span>**</span>
<span>-</span> Name<span>,</span> Alter<span>,</span> Herkunft<span>,</span> Sprechweise<span>,</span> Fachkenntnis<span>,</span> Auftreten gegenÃ¼ber Kunden<span>.</span>
<span>-</span> Beschreibung des Ã¤uÃŸeren Erscheinungsbildes<span>:</span> Kleidung<span>,</span> Schmuck<span>,</span> KÃ¶rperhaltung<span>,</span> Frisur<span>,</span> eventuell Zauberartefakte<span>.</span>
<span>**</span><span>4.</span> Die Angestellten <span>(</span>mindestens <span>1</span>â€“<span>2</span><span>)</span><span>:</span><span>**</span>
<span>-</span> Aufgaben<span>,</span> Umgang mit Kunden<span>,</span> Hierarchie<span>,</span> besondere Eigenheiten<span>.</span>
<span>-</span> Auch hier<span>:</span> detaillierte Beschreibung von Kleidung<span>,</span> Haar<span>,</span> Gang<span>,</span> Umgangsformen etc<span>.</span>
<span>**</span><span>5.</span> Preisniveau <span>&amp;</span> QualitÃ¤t<span>:</span><span>**</span>
<span>-</span> Welches Klientel wird angesprochen <span>(</span>z<span>.</span>â€¯B<span>.</span> Adlige<span>,</span> Magier<span>,</span> wohlhabende HÃ¤ndler<span>)</span>?
<span>-</span> Wie hebt sich der Laden von anderen ab <span>(</span>Handwerkskunst<span>,</span> Herkunft der Waren<span>,</span> exzellenter Service<span>,</span> ExklusivitÃ¤t<span>)</span>?
Stilvorgabe<span>:</span>
<span>-</span> Schreibe literarisch<span>,</span> atmosphÃ¤risch<span>,</span> mit bildhafter Sprache und einem Hauch Poesie<span>.</span>
<span>-</span> Der Text soll beim Lesen die Fantasie anregen und eine Szene lebendig machen<span>,</span> wie sie <span>in</span> einem gut ausgearbeiteten Pen<span>-</span><span>&amp;</span><span>-</span>Paper<span>-</span>Abenteuer vorkommen kÃ¶nnte<span>.</span>
<span>-</span> Vermeide moderne Begriffe oder Konzepte<span>.</span> Halte die Sprache dem Setting entsprechend<span>.</span>
</code><button></button></pre>
<h2 data-heading="Schneidereien">Schneidereien</h2>
<h3 data-heading="**â€žZum Goldenen Zwirnâ€œ â€“ Ein Gewandhaus fÃ¼r Edelleute**"><strong>â€žZum Goldenen Zwirnâ€œ â€“ Ein Gewandhaus fÃ¼r Edelleute</strong></h3>
<p>In einer gepflegten Seitengasse des gehobenen Viertels von Gareth liegt der ehrwÃ¼rdige Laden â€žZum Goldenen Zwirnâ€œ, ein Refugium fÃ¼r jene, die sich mit Stil, Geschmack und Eleganz zu kleiden wissen. Schon die Schaufenster lassen die edlen Stoffe in tiefem Purpur, kÃ¶nigsblauem Samt und feinem Goldbrokat erkennen, die kunstvoll auf Schneiderpuppen drapiert sind. Der sÃ¼ÃŸe Duft von Lavendel und gepressten RosenblÃ¤ttern liegt in der Luft, gemischt mit der herben Note von Bienenwachs und feinster Seide. Betritt man das Ladeninnere, empfÃ¤ngt einen ein warmes Licht, das von zahlreichen Ã–llampen auf polierte Holzregale, schwere Stoffballen und ziselierte Schneiderwerkzeuge fÃ¤llt.</p>
<p>Der Besitzer des Ladens, <strong>Meister Albrecht von Seidenstich</strong>, ist ein Mann, dessen Erscheinung fast selbst ein Kunstwerk ist. GroÃŸ gewachsen und von schlanker Statur, trÃ¤gt er sein schlohweiÃŸes Haar stets zu einem eleganten Knoten gebunden. Sein Gesicht ist markant, mit hohen Wangenknochen und einem ruhigen, prÃ¼fenden Blick, der Stoffe mit derselben PrÃ¤zision betrachtet wie die Haltung eines Kunden. Ein edelblauer Samtwams mit goldenen KnÃ¶pfen liegt makellos Ã¼ber seinem schmalen OberkÃ¶rper, ergÃ¤nzt durch einen silbernen Gehrock mit Brokatmuster. Auf seiner Brust prangt eine goldene Brosche in Form einer Schere â€“ das Familienzeichen der Seidenstichs. Stets mit weiÃŸen Spitzenhandschuhen bekleidet, berÃ¼hrt er Stoff nur mit Andacht und Sorgfalt, als wÃ¤ren sie heilige Reliquien.</p>
<p>UnterstÃ¼tzt wird er von zwei jungen Gesellen: <strong>Leontin</strong> und <strong>Iselda</strong>. Leontin, ein aufgeweckter junger Mann mit zerzaustem braunem Haar, arbeitet flink und zielstrebig, seine Finger fast stÃ¤ndig mit Nadel und Faden beschÃ¤ftigt. Er trÃ¤gt ein hellgraues Arbeitskittelgewand, das schlicht, aber tadellos sauber ist. Iselda hingegen, eine elegante junge Frau mit in einer geflochtenen Krone gestecktem blondem Haar, bewegt sich mit fast tÃ¤nzerischer Anmut durch das Atelier. Sie trÃ¤gt ein bodenlanges Leinenkleid mit einem gestreiften Halbschurz, auf dem stets eine Stecknadel oder ein MaÃŸband bereitliegt. Ihre Kleidung ist schlicht, aber stilvoll â€“ ein Zeichen, dass sie weiÃŸ, was SchÃ¶nheit ist, ohne prunkvoll zu wirken.</p>
<p>â€žZum Goldenen Zwirnâ€œ ist nicht nur ein Ort, an dem Kleidung gefertigt wird â€“ es ist ein Tempel der Eleganz, in dem aus Garn und Stoff Geschichten gewoben werden. Jeder Kunde, der hier eintritt, wird nicht nur mit Kleidung bedacht, sondern mit einer IdentitÃ¤t â€“ maÃŸgeschneidert bis ins letzte Detail.</p>
<h3 data-heading="&quot;Zum Kaiserlichen Gewand&quot; - Hochwertige Schneiderei">"Zum Kaiserlichen Gewand" - Hochwertige Schneiderei</h3>
<p>In einer der vornehmsten StraÃŸen Gareths, unweit des Praios-Tempels, befindet sich die renommierte Schneiderei "Zum Kaiserlichen Gewand". Das imposante Fachwerkhaus mit seinen kunstvoll geschnitzten Holzornamenten und groÃŸen Schaufenstern zieht sofort die Blicke auf sich. Meister Aldrich von Gareth, ein distinguierter Herr mit silbernem Haar und scharfem Blick, leitet dieses Etablissement seit Ã¼ber drei Jahrzehnten.</p>
<p>Die Besonderheit des "Kaiserlichen Gewands" liegt in der Verwendung Ã¤uÃŸerst seltener und exquisiter Stoffe, die Aldrich durch ein Netzwerk von HÃ¤ndlern aus allen Teilen Aventuriens bezieht. Seine Beziehungen reichen bis in den Hof des Mittelreiches, was ihm Zugang zu Materialien verschafft, die anderen Schneidern verwehrt bleiben.</p>
<p>Beim Betreten des Ladens wird der edle Kunde von einem Duft aus feinstem Bienenwachs und edlen HÃ¶lzern empfangen. Die WÃ¤nde sind mit Stoffbahnen in satten Farben behangen - scharlachrotes Tuch aus Al'Anfa, azurblaue Seide aus Khunchom und golddurchwirkter Brokat aus Fasar. In einer Ecke arbeiten Gesellen eifrig an NÃ¤hten und Stickereien, wÃ¤hrend auf einem massiven Eichentisch MusterbÃ¼cher mit den neuesten ModeentwÃ¼rfen aus Vinsalt und Punin ausliegen.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Aldrich ein Ensemble aus schwerem, burgunderrotem Samt, der so dicht gewebt ist, dass er im Licht wie flÃ¼ssiges Metall schimmert. Das Wams wird mit handgefertigten KnÃ¶pfen aus poliertem Bernstein versehen, wÃ¤hrend die Beinlinge aus feinstem, butterweichem Leder gefertigt sind. Ein Umhang aus nachtblauem Tuch, gefÃ¼ttert mit silbergrauem Seidendamast, rundet das Outfit ab.</p>
<p>Die Anprobe gleicht einem Ritual, bei dem Aldrich persÃ¶nlich jeden Zentimeter des Stoffes prÃ¼ft und anpasst. Er erklÃ¤rt seinem edlen Kunden die Herkunft und Besonderheiten jedes Materials, von der Zucht der Seidenraupen bis zur komplexen Webtechnik des Damastes. Aldrich betont, wie die sorgfÃ¤ltige Auswahl der Stoffe und Schnitte die natÃ¼rliche Ausstrahlung und den Stand des TrÃ¤gers unterstreichen.</p>
<p>Als besonderes Detail schlÃ¤gt Aldrich vor, das Wappen des Adelshauses subtil in das Muster des Ã„rmelsaums einzuarbeiten - ein Zeichen von Stolz und ZugehÃ¶rigkeit, das nur den aufmerksamsten Beobachtern auffallen wird. Die Fertigstellung eines solchen Meisterwerks nimmt mehrere Wochen in Anspruch, aber Aldrich garantiert, dass das Ergebnis jeden Preis und jede Wartezeit wert sein wird.</p>
<h3 data-heading="&quot;Seidenfaden &amp; Nadelkunst&quot; - Exquisite Stickerei">"Seidenfaden &amp; Nadelkunst" - Exquisite Stickerei</h3>
<p>In einer ruhigen SeitenstraÃŸe des HÃ¤ndlerviertels von Gareth befindet sich "Seidenfaden &amp; Nadelkunst", ein unscheinbares, aber Ã¤uÃŸerst renommiertes Atelier fÃ¼r Stickerei und Verzierungen. Das kleine LadengeschÃ¤ft wird von Meisterin Eleonora Fadenfein gefÃ¼hrt, einer zierlichen Frau mit flinken Fingern und einem Auge fÃ¼r kleinste Details.</p>
<p>Die Einzigartigkeit von "Seidenfaden &amp; Nadelkunst" liegt in Eleonoras auÃŸergewÃ¶hnlicher FÃ¤higkeit, historische Stickereien und Verzierungen zu reproduzieren und zu interpretieren. Ihre Werkstatt beherbergt eine umfangreiche Sammlung von MusterbÃ¼chern und Zeichnungen, die Stickereien aus verschiedenen Epochen und Kulturen Aventuriens dokumentieren.</p>
<p>Der Laden selbst ist ein Paradies fÃ¼r Liebhaber feiner Handarbeit. An den WÃ¤nden hÃ¤ngen Rahmen mit kunstvollen Stickereien, von filigranen Blumenmustern bis hin zu komplexen heraldischen Darstellungen. Glasvitrinen prÃ¤sentieren eine Auswahl an Garnen in hunderten von Farbnuancen, von schimmernder Seide bis zu FÃ¤den, die mit Goldflocken durchzogen sind.</p>
<p>FÃ¼r den festlichen Empfang schlÃ¤gt Eleonora vor, ein bereits vorhandenes edles Gewand durch ihre Kunst aufzuwerten. Sie empfiehlt eine aufwÃ¤ndige Stickerei am Kragen und den Ã„rmelaufschlÃ¤gen, die Szenen aus der Geschichte des Adelshauses darstellt. DafÃ¼r verwendet sie feinste SeidenfÃ¤den in subtil abgestuften FarbtÃ¶nen, ergÃ¤nzt durch echte GoldfÃ¤den fÃ¼r Akzente und Highlights.</p>
<p>Die Planung der Stickerei ist ein kreativer Prozess, bei dem Eleonora eng mit dem Kunden zusammenarbeitet. Sie studiert die Familienchroniken, um bedeutsame Ereignisse und Symbole zu identifizieren, und erstellt detaillierte EntwÃ¼rfe, die sie dem Adligen zur Genehmigung vorlegt. Jeder Stich wird von Eleonora persÃ¶nlich ausgefÃ¼hrt, oft unter Verwendung einer Lupe, um absolute PrÃ¤zision zu gewÃ¤hrleisten.</p>
<p>Eleonora erklÃ¤rt ihrem edlen Kunden die Bedeutung jedes Elements der Stickerei und wie es zur Gesamtkomposition beitrÃ¤gt. Sie betont, wie die feine Handarbeit nicht nur die Kleidung verschÃ¶nert, sondern auch eine Geschichte erzÃ¤hlt und den Status des TrÃ¤gers unterstreicht. Als besonderes Angebot schlÃ¤gt sie vor, einen winzigen GlÃ¼cksbringer - vielleicht das Wappentier der Familie - an einer versteckten Stelle einzusticken, als persÃ¶nlichen Talisman fÃ¼r den TrÃ¤ger.</p>
<h3 data-heading="&quot;Pelzwerk &amp; Federpracht&quot; - Exklusive Accessoires">"Pelzwerk &amp; Federpracht" - Exklusive Accessoires</h3>
<p>Am Prachtboulevard von Gareth, nur einen Steinwurf vom Palast entfernt, befindet sich "Pelzwerk &amp; Federpracht", ein exklusives GeschÃ¤ft fÃ¼r edle Accessoires. Der Laden besticht durch seine opulente Einrichtung mit dunklem Holz, vergoldeten Spiegeln und weichen Teppichen. Meister Konrad Pelzner, ein stattlicher Mann mit gepflegtem Bart und stets tadellos gekleidet, empfÃ¤ngt hier seine illustre Kundschaft.</p>
<p>Die Besonderheit von "Pelzwerk &amp; Federpracht" liegt in Konrads unÃ¼bertroffener Expertise in der Verarbeitung seltenster Pelze und exotischer Federn. Sein GeschÃ¤ft ist die erste Adresse fÃ¼r alle, die ihren GewÃ¤ndern den letzten Schliff verleihen wollen.</p>
<p>Der Laden ist ein Fest fÃ¼r die Sinne. Weiche Pelze in allen erdenklichen Farben und Texturen schmÃ¼cken die WÃ¤nde, von schneeweiÃŸem Polarfuchs bis zu samtschwarzem Nerz. In Glasvitrinen werden kunstvoll arrangierte Federkollektionen prÃ¤sentiert, darunter schillernde Pfauenfedern, majestÃ¤tische Adlerfedern und zarte Reiherfedern.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Konrad einen Umhangkragen aus silbergrauem Zobelpelz, der perfekt mit dem vom Schneider gefertigten Gewand harmoniert. Als ErgÃ¤nzung schlÃ¤gt er Manschetten aus dem gleichen Pelz vor, um ein einheitliches Bild zu schaffen. FÃ¼r einen dramatischen Akzent rÃ¤t er zu einer Brosche mit einer kunstvoll arrangierten Komposition aus Pfauenfedern und Fasanenfedern, die das Licht in schillernden Farben reflektieren.</p>
<p>Die Auswahl der perfekten Accessoires ist ein langwieriger Prozess. Konrad prÃ¤sentiert verschiedene Pelzarten und lÃ¤sst den Kunden ihre Weichheit und WÃ¤rme spÃ¼ren. Er erklÃ¤rt die Herkunft jedes Pelzes und jeder Feder, oft mit Anekdoten Ã¼ber die Jagd oder den Handel, der nÃ¶tig war, um sie zu beschaffen. FÃ¼r die Brosche wÃ¤hlt er jede Feder einzeln aus und arrangiert sie vor den Augen des Kunden, um die perfekte Komposition zu finden.</p>
<p>Konrad betont, wie die richtige Wahl der Accessoires ein Gewand von schÃ¶n zu auÃŸergewÃ¶hnlich machen kann. Er berÃ¤t seinen edlen Kunden auch zur Pflege der Pelze und Federn, damit diese Ã¼ber Generationen hinweg ihre Pracht behalten. Als besonderes Angebot prÃ¤sentiert er eine Sammlung antiker KnÃ¶pfe aus Elfenbein und Perlmutt, die er Ã¼ber Jahre hinweg gesammelt hat und die dem Gewand einen Hauch von Geschichte verleihen wÃ¼rden.</p>
<h3 data-heading="&quot;Zur Goldenen Schere&quot; - Traditionelle Schneiderei">"Zur Goldenen Schere" - Traditionelle Schneiderei</h3>
<p>In einer der Ã¤ltesten Gassen Gareths, umgeben von ehrwÃ¼rdigen FachwerkhÃ¤usern, befindet sich "Zur Goldenen Schere", eine Schneiderei, die seit Generationen im Besitz der Familie Nadelstich ist. Der aktuelle Inhaber, Meister Gottfried Nadelstich, ein freundlicher Mann mittleren Alters mit einer markanten Brille, fÃ¼hrt das GeschÃ¤ft mit Stolz und Hingabe.</p>
<p>Die Einzigartigkeit der "Goldenen Schere" liegt in ihrer Spezialisierung auf traditionelle Schnitt- und NÃ¤htechniken, die in vielen modernen Schneidereien in Vergessenheit geraten sind. Gottfried bewahrt das Wissen und die Fertigkeiten seiner Vorfahren und kombiniert sie mit einem GespÃ¼r fÃ¼r zeitgemÃ¤ÃŸe Eleganz.</p>
<p>Der Laden atmet Geschichte. Alte Schneiderscheren, NÃ¤hmaschinen aus vergangenen Epochen und vergilbte Schnittmuster schmÃ¼cken die WÃ¤nde. In Regalen stapeln sich schwere Stoffballen in gedeckten, klassischen Farben - Schwarz, Marineblau, DunkelgrÃ¼n und verschiedene BrauntÃ¶ne. Der Duft von Wollstoffen und Bienenwachs erfÃ¼llt den Raum.</p>
<p>FÃ¼r den festlichen Empfang schlÃ¤gt Gottfried einen klassischen Gehrock aus schwerem, nachtblauem Wollstoff vor, gefÃ¼ttert mit feinster Seide. Die KnÃ¶pfe werden aus poliertem Horn gefertigt, jeder ein Unikat. Dazu empfiehlt er eine Weste aus cremefarbenem Brokat mit einem subtilen Muster und Beinlinge aus feinem, anthrazitfarbenem Wollstoff.</p>
<p>Die Anpassung des Gewandes ist ein zeitaufwÃ¤ndiger Prozess, bei dem Gottfried Techniken anwendet, die er von seinem GroÃŸvater erlernt hat. Er erklÃ¤rt seinem edlen Kunden die Vorteile jeder Naht und jeden Schnitts, wie sie Haltbarkeit und Tragekomfort erhÃ¶hen. Besonders stolz ist er auf seine handgenÃ¤hten KnopflÃ¶cher, die er als kleine Kunstwerke betrachtet.</p>
<p>Gottfried legt groÃŸen Wert darauf, dass das Gewand nicht nur gut aussieht, sondern auch praktisch ist. Er fÃ¼gt versteckte Taschen hinzu, passt die LÃ¤nge des Gehrocks perfekt an die KÃ¶rpergrÃ¶ÃŸe an und achtet darauf, dass alle Bewegungen bequem mÃ¶glich sind. Als besondere Tradition der "Goldenen Schere" wird in jedes KleidungsstÃ¼ck ein kleiner GlÃ¼cksbringer eingenÃ¤ht - ein winziges StÃ¼ck roten Stoffes, das Wohlstand und langes Leben verheiÃŸen soll.</p>
<p>Zum Abschluss prÃ¤sentiert Gottfried eine Auswahl an Accessoires, die seit Generationen in seiner Familie weitergegeben wurden: Krawattennadeln, ManschettenknÃ¶pfe und TaschentÃ¼cher aus feinstem Leinen, jedes mit einer eigenen Geschichte. Er bietet an, eines dieser ErbstÃ¼cke als "Leihgabe" fÃ¼r den besonderen Anlass zur VerfÃ¼gung zu stellen, um dem Outfit den letzten Schliff zu geben.</p>
<h3 data-heading="Der edle Schneider &quot;Zum Goldenen Praiosfaden&quot;">Der edle Schneider "Zum Goldenen Praiosfaden"</h3>
<p>In einer engen Gasse Gareths, der Hauptstadt des Mittelreichs, zwischen FachwerkhÃ¤usern eingezwÃ¤ngt, befindet sich die Schneiderei "Zum Goldenen Praiosfaden". Ein kunstvoll geschnitztes Schild mit einer goldenen Nadel und Faden, die das Symbol Praios' nachahmen, weist den Weg. Durch die bleiverglaste TÃ¼r betritt man einen Raum, der von feinen Stoffen und dem Duft von Bienenwachs erfÃ¼llt ist.</p>
<p>Der Meisterschneider Garibald von Gareth, ein hagerer Mann mit flinken Fingern und scharfem Auge, begrÃ¼ÃŸt seine adlige Kundschaft mit einer tiefen Verbeugung. An den WÃ¤nden hÃ¤ngen Stoffbahnen in satten Farben - scharlachrotes Tuch aus Al'Anfa, azurblaue Seide aus Khunchom und golddurchwirkter Brokat aus Fasar.</p>
<p>In einer Ecke arbeiten Gesellen eifrig an NÃ¤hten und Stickereien. Auf einem massiven Eichentisch liegen MusterbÃ¼cher mit den neuesten ModeentwÃ¼rfen aus Vinsalt und Punin. Garibald prÃ¤sentiert seinem edlen Kunden die feinsten Materialien fÃ¼r ein prÃ¤chtiges Wams: Samt in tiefen Burgunderrot, mit goldenen FÃ¤den durchzogen, die das Wappen des Hauses Rabenmund darstellen.</p>
<p>Mit geÃ¼btem Blick nimmt er MaÃŸ und skizziert einen Entwurf, der die breiten Schultern des Adligen betont. Er schlÃ¤gt vor, die Ã„rmel mit Schlitzen zu versehen, durch die das schneeweiÃŸe Leinenhemd hindurchschimmern wird - der letzte Schrei der Mode am Hofe Kaiser Hals.</p>
<p>FÃ¼r die Beinlinge empfiehlt er eng anliegendes Tuch in einem dunklen GrÃ¼n, das perfekt mit dem Wams harmoniert und an die WÃ¤lder des Reichsforstes erinnert. Als krÃ¶nenden Abschluss prÃ¤sentiert Garibald einen mit Fuchspelz gefÃ¼tterten Umhang aus feinstem Wollstoff aus Weiden, der die noble Erscheinung abrunden wird.</p>
<p>Garibald: "Ich verstehe". Nun grÃ¼n und schwarz harmonieren ganz vorzÃ¼glich - dazu ein hauch von Gold. Ja ich kann es bereits vor mir sehen ich denke vielleicht also ein GrÃ¼ner Rock, durchwirkt mit Gold mit geschlitzen Ã„rmeln, dazu ein weiÃŸes Hemd mit Spitzenbesatz. Goldene oder silberne KnÃ¶pfe mit eurem Wappen oder Monogram wÃ¼rden gar vorzÃ¼glich damit harmonieren. Eine Schwarze Hose aus feinstem Elfenbausch mit einer goldenen Ziernaht die entlang der Beinlinge verlÃ¤uft. Dazu grÃ¼ne oder weiÃŸe Socken und grÃ¼ne Gamaschen oder schwarze Stiefel. Als krÃ¶nenden Abschluss prÃ¤sentiert Garibald einen mit Fuchspelz gefÃ¼tterten Umhang aus feinstem Wollstoff aus Weiden, der die noble Erscheinung abrunden wird.</p>
<h3 data-heading="&quot;Zum magischen Faden&quot; - Meisterschneiderei">"Zum magischen Faden" - Meisterschneiderei</h3>
<p>In einer der vornehmsten Gassen Gareths, unweit des Praios-Tempels, befindet sich die renommierte Schneiderei "Zum Goldenen Faden". Das GebÃ¤ude selbst ist ein architektonisches Kleinod, mit kunstvoll geschnitzten Holzornamenten und groÃŸen Schaufenstern, in denen die neuesten Kreationen zur Schau gestellt werden.</p>
<p>Meister Alrik von Gareth, ein hagerer Mann mit scharfem Blick und flinken Fingern, leitet dieses Etablissement mit PrÃ¤zision und Leidenschaft. Seine Werkstatt im hinteren Teil des Ladens gleicht einem Heiligtum der Schneiderkunst, wo feinste Stoffe aus allen Teilen Aventuriens verarbeitet werden.</p>
<p>Das Besondere an "Zum Goldenen Faden" ist die Verwendung magisch veredelter FÃ¤den, die von Alriks Schwester, einer Gildenmagierin, verzaubert werden. Diese FÃ¤den verleihen den GewÃ¤ndern nicht nur einen Ã¼bernatÃ¼rlichen Glanz, sondern auch subtile magische Eigenschaften wie Schmutzabweisung oder Temperaturregulierung.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Alrik ein Ensemble aus scharlachrotem Brokat aus Al'Anfa, bestickt mit goldenen FÃ¤den, die das Wappen des Adligen darstellen. Das Wams wird mit KnÃ¶pfen aus Mondsilber versehen, wÃ¤hrend die Beinlinge aus feinstem Leder gefertigt sind, das so weich ist, dass es wie eine zweite Haut anliegt.</p>
<p>Die Anprobe gleicht einem Ritual, bei dem Alrik jeden Zentimeter des Stoffes prÃ¼ft und anpasst, bis die Perfektion erreicht ist. Seine Assistenten, allesamt MeisterschÃ¼ler der renommiertesten Schneiderakademien des Reiches, stehen bereit, um jede Nadel und jeden Faden zu reichen.</p>
<h3 data-heading="&quot;Praiosgold&quot; - Imperiale Pracht">"Praiosgold" - Imperiale Pracht</h3>
<p>In einem prachtvollen Stadtpalais nahe des Kaiserpalastes residiert "Praiosgold". Der Laden empfÃ¤ngt seine Kunden mit einer Fassade aus glÃ¤nzendem Marmor und goldenen Verzierungen.</p>
<p>Meister Aurelius von Grangor, ein distinguierter Herr mit makellosem Auftreten, leitet das GeschÃ¤ft. Der Empfangsraum gleicht einem Thronsaal, mit hohen Spiegeln und kristallenen Kronleuchtern.</p>
<p>"Praiosgold" spezialisiert sich auf GewÃ¤nder, die imperiale Macht und gÃ¶ttliche AutoritÃ¤t ausstrahlen. Hier findet man:</p>
<ul>
<li>Prunkvolle Roben in Goldbrokat, besetzt mit echten Edelsteinen</li>
<li>MÃ¤ntel aus schimmernder Seide, deren Muster subtil das kaiserliche Wappen nachbilden</li>
<li>Kopfbedeckungen, die an stilisierte Kronen erinnern</li>
</ul>
<p>Jedes KleidungsstÃ¼ck wird individuell angefertigt und soll den TrÃ¤ger wie einen lebenden Vertreter des GÃ¶tterfÃ¼rsten Praios erscheinen lassen.</p>
<h3 data-heading="&quot;Rondras RÃ¼stkammer&quot; - Martialische Eleganz">"Rondras RÃ¼stkammer" - Martialische Eleganz</h3>
<p>In einem burgÃ¤hnlichen GebÃ¤ude im Adelsvirtel befindet sich "Rondras RÃ¼stkammer". Der Eingang wird von zwei lebensgroÃŸen Ritterstatuen flankiert.</p>
<p>Die Besitzerin, Alrike von Mersingen, eine ehemalige Ritterin mit imposanter PrÃ¤senz, begrÃ¼ÃŸt ihre Kunden persÃ¶nlich. Der Innenraum erinnert an eine prachtvolle Waffenhalle, mit Wandteppichen heroischer Schlachten und kunstvoll arrangierten RÃ¼stungsteilen.</p>
<p>"Rondras RÃ¼stkammer" bietet Festtagskleidung, die martialische Eleganz mit hÃ¶fischer Etikette verbindet:</p>
<ul>
<li>WÃ¤mser aus feinstem Leder, verziert mit filigranen Metallapplikationen</li>
<li>UmhÃ¤nge, die an WaffenrÃ¶cke erinnern, jedoch aus luxuriÃ¶sen Stoffen gefertigt sind</li>
<li>Schmuck, der subtil Waffen und RÃ¼stungsteile nachahmt</li>
</ul>
<p>Die Kreationen vermitteln kriegerische StÃ¤rke, ohne dabei die Grenzen der Hofetikette zu Ã¼berschreiten.</p>
<h3 data-heading="&quot;Travias Herd&quot; - FamiliÃ¤re WÃ¼rde">"Travias Herd" - FamiliÃ¤re WÃ¼rde</h3>
<p>In einem gemÃ¼tlichen, mehrstÃ¶ckigen BÃ¼rgerhaus am Praioshof befindet sich "Travias Herd". Der Eingang ist von einem Ã¼ppigen Blumengarten umgeben.</p>
<p>Die Schneidermeisterin Alina Friedenstochter, eine mÃ¼tterliche Frau mit warmem LÃ¤cheln, leitet den Laden. Der Innenraum erinnert an ein nobles Wohnzimmer, mit bequemen Sesseln und einem stets brennenden Kamin.</p>
<p>"Travias Herd" spezialisiert sich auf Kleidung, die familiÃ¤re WÃ¼rde und Tradition betont:</p>
<ul>
<li>Ensembles, die subtil Familienwappen und -farben integrieren</li>
<li>GenerationenÃ¼bergreifende Designs, die Eltern und Kinder harmonisch einkleiden</li>
<li>Accessoires, die FamilienerbstÃ¼cke elegant in moderne Moden einbinden</li>
</ul>
<p>Diese GewÃ¤nder sollen die Bedeutung von Familie und Abstammung am Hof unterstreichen, ohne protzig zu wirken.</p>
<h3 data-heading="&quot;Mondscheinweberei&quot; - Elfische Gewandungen am Rosenplatz">"Mondscheinweberei" - Elfische Gewandungen am Rosenplatz</h3>
<p>Am Rosenplatz, einem der schÃ¶nsten Orte Gareths, steht ein uralter Eichenbaum, in dessen Krone sich die "Mondscheinweberei" befindet. Silbrige Treppen, die sich perfekt in die Architektur des Platzes einfÃ¼gen, fÃ¼hren zu einer eleganten Plattform in den Ã„sten.</p>
<p>Die elfische Weberin Larianel, eine Botschafterin des Waldelfenreiches, empfÃ¤ngt hier Kunden mit anmutiger Gelassenheit. Ihre GewÃ¤nder scheinen aus Mondlicht und dem Tau des Garether Rosengartens gewoben. In der Luft schweben schimmernde Stoffe, die ihre Farbe je nach Tageszeit Ã¤ndern, inspiriert von den wechselnden Lichtern der Kaiserstadt.</p>
<p>Larianel fertigt Kleidung, die die Eleganz der elfischen Kultur mit dem Prunk des kaiserlichen Hofes verbindet. MÃ¤ntel aus immergrÃ¼nen BlÃ¤ttern, verziert mit goldenen FÃ¤den, die das Wappen des Mittelreiches nachbilden, Hemden aus Spinnenseide, so leicht wie der Nebel Ã¼ber dem GroÃŸen Fluss, und Schuhe aus weichem Leder, die lautlos Ã¼ber Marmor und Parkett gleiten.</p>
<p>FÃ¼r besondere Kunden, wie hohe Adlige oder kaiserliche Gesandte, webt Larianel GewÃ¤nder mit subtiler elfischer Magie: UmhÃ¤nge, die in den geschÃ¤ftigen StraÃŸen Gareths Ruhe und Gelassenheit vermitteln, Kleider, die vor den Intrigen des Hofes schÃ¼tzen, oder Handschuhe, die jede BerÃ¼hrung in harmonische Diplomatie verwandeln.</p>
<h3 data-heading="&quot;Zur Bunten Karawane&quot; - Exotische Moden am Neumarkt">"Zur Bunten Karawane" - Exotische Moden am Neumarkt</h3>
<p>Auf dem Neumarkt, dem pulsierenden Herzen des Garether Handels, steht ein farbenfrohes Ensemble aus Zelten und Wagen - die "Bunte Karawane". Hier findet man Mode aus allen Teilen des Mittelreiches und darÃ¼ber hinaus.</p>
<p>Die Besitzerin, die geschÃ¤ftstÃ¼chtige HÃ¤ndlerin Shaila von Gareth, ist eine lebhafte Frau mit scharfem Verstand und einer Vorliebe fÃ¼r die neuesten Modetrends aus allen Provinzen des Reiches. In ihren Zelten herrscht ein Gewirr aus Farben, DÃ¼ften und KlÃ¤ngen, die die Vielfalt der Kaiserstadt widerspiegeln.</p>
<p>Jeder Wagen reprÃ¤sentiert eine andere Region des Reiches: Prunkvolle Roben aus Vinsalt neben praktischen JagdgewÃ¤ndern aus dem Weiden, festliche Trachten aus dem Kosch neben eleganten Uniformen der kaiserlichen Garde. Shaila kennt die Geschichte und Bedeutung jedes einzelnen StÃ¼cks und versteht es, sie perfekt an die BedÃ¼rfnisse der Garether Gesellschaft anzupassen.</p>
<p>FÃ¼r die Oberschicht Gareths hÃ¤lt Shaila besondere SchÃ¤tze bereit: GewÃ¤nder, die einst von berÃ¼hmten Helden des Mittelreiches getragen wurden, magische Accessoires aus den entlegensten Provinzen oder KleidungsstÃ¼cke, die angeblich vom Kaiser selbst in Auftrag gegeben wurden.</p>
<h3 data-heading="&quot;Zum magischen Zwirn&quot; - Meisterschneiderei">"Zum magischen Zwirn" - Meisterschneiderei</h3>
<p>In einer der vornehmsten Gassen Gareths, unweit des prachtvollen Hesinde Tempels, befindet sich die renommierte Schneiderei "Zum Goldenen Faden". Das GebÃ¤ude selbst ist ein architektonisches Kleinod, mit kunstvoll geschnitzten Holzornamenten und groÃŸen Schaufenstern, in denen die neuesten Kreationen zur Schau gestellt werden. Meister Alrik von Gareth, ein hagerer Mann mit scharfem Blick und flinken Fingern, leitet dieses Etablissement mit PrÃ¤zision und Leidenschaft.</p>
<p>Die Besonderheit des "magischen Zwirns" liegt in der Verwendung magisch veredelter FÃ¤den, die von Alriks Schwester, einer Gildenmagierin, verzaubert werden. Diese FÃ¤den verleihen den GewÃ¤ndern nicht nur einen Ã¼bernatÃ¼rlichen Glanz, sondern auch subtile magische Eigenschaften wie Schmutzabweisung oder Temperaturregulierung.</p>
<p>Beim Betreten des Ladens wird der edle Kunde von einem Duft aus feinstem Bienenwachs und edlen HÃ¶lzern empfangen. Die WÃ¤nde sind mit Stoffbahnen in satten Farben behangen - scharlachrotes Tuch aus Al'Anfa, azurblaue Seide aus Khunchom und golddurchwirkter Brokat aus Fasar. In einer Ecke arbeiten Gesellen eifrig an NÃ¤hten und Stickereien, wÃ¤hrend auf einem massiven Eichentisch MusterbÃ¼cher mit den neuesten ModeentwÃ¼rfen aus Vinsalt und Punin ausliegen.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Alrik ein Ensemble aus scharlachrotem Brokat, bestickt mit goldenen FÃ¤den, die das Wappen des Adligen darstellen. Das Wams wird mit KnÃ¶pfen aus Mondsilber versehen, wÃ¤hrend die Beinlinge aus feinstem Leder gefertigt sind, das so weich ist, dass es wie eine zweite Haut anliegt. Die Anprobe gleicht einem Ritual, bei dem Alrik jeden Zentimeter des Stoffes prÃ¼ft und anpasst, bis die Perfektion erreicht ist.</p>
<p>Alrik erklÃ¤rt seinem edlen Kunden die Besonderheiten jedes Stoffes, von der Herkunft der Seide bis zur komplexen Webtechnik des Brokats. Er betont, wie die magischen FÃ¤den subtil eingearbeitet wurden, um die natÃ¼rliche Ausstrahlung des TrÃ¤gers zu verstÃ¤rken, ohne dabei aufdringlich zu wirken. Als krÃ¶nenden Abschluss prÃ¤sentiert Alrik einen Umhang aus schwerem, nachtblauem Samt, dessen Innenfutter mit einer Karte des Sternenhimmels bestickt ist - ein subtiler Hinweis auf die kosmische Ordnung und die Stellung des Adels darin.</p>
<h3 data-heading="&quot;Farbenzauber&quot; - StoffÃ¤rberei und Musterweberei">"Farbenzauber" - StoffÃ¤rberei und Musterweberei</h3>
<p>Am Ufer des GroÃŸen Flusses, in einem bunten Fachwerkhaus, befindet sich "Farbenzauber". Der Laden ist von einem Ã¼ppigen Garten umgeben, in dem seltene Pflanzen fÃ¼r Farbstoffe kultiviert werden. Der Duft exotischer BlÃ¼ten und KrÃ¤uter erfÃ¼llt die Luft und zieht Besucher magisch an.</p>
<p>Meisterin Iris Buntweberin, eine lebhafte Frau mit farbbefleckten HÃ¤nden und stets wechselnden Haarfarben, leitet das GeschÃ¤ft mit ansteckender Begeisterung. Ihre Werkstatt ist ein Labyrinth aus FÃ¤rbebottichen, WebstÃ¼hlen und Trockengestellen, wo Stoffe in allen erdenklichen Farben und Mustern entstehen.</p>
<p>Das Besondere an "Farbenzauber" ist Iris' einzigartige FÃ¤higkeit, Stoffe zu fÃ¤rben, die ihre Farbe je nach Licht oder Stimmung des TrÃ¤gers Ã¤ndern kÃ¶nnen. Sie erreicht dies durch eine Kombination aus alchemistischen FÃ¤rbemitteln und feiner Illusionsmagie, ein Geheimnis, das sie von einer reisenden Hexe aus dem Hohen Norden erlernt hat.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Iris einen Stoff, der tagsÃ¼ber in einem tiefen Blau schimmert, bei Kerzenlicht jedoch einen purpurnen Glanz annimmt. Das eingewebte Muster zeigt subtile Szenen aus der Geschichte des Adelshauses, die nur aus bestimmten Blickwinkeln sichtbar werden - ein faszinierendes GesprÃ¤chsthema fÃ¼r jeden Ball.</p>
<p>Der Auswahlprozess gleicht einer Farbberatung, bei der Iris nicht nur die Hautfarbe und Haarfarbe des Kunden berÃ¼cksichtigt, sondern auch dessen PersÃ¶nlichkeit und die gewÃ¼nschte Wirkung bei Hofe. Sie erklÃ¤rt, wie bestimmte Farben und Muster die Wahrnehmung anderer beeinflussen kÃ¶nnen, von Respekt einflÃ¶ÃŸend bis charmant und zugÃ¤nglich.</p>
<p>Iris fÃ¼hrt ihren edlen Kunden durch einen Raum voller schimmernder Stoffbahnen, jede mit einer eigenen Geschichte und Bedeutung. Sie erzÃ¤hlt von den Reisen, die sie unternommen hat, um seltene Farbstoffe zu finden, und von den Geheimnissen der Farbmagie, die sie in den entlegensten Winkeln Aventuriens entdeckt hat.</p>
<h2 data-heading="Schuster">Schuster</h2>
<h3 data-heading="Lerikes Schuhladen">Lerikes Schuhladen</h3>
<p><a href="DSA Kampagne/00 Dashboard/01 Szenentexte/Szene Im Schuhladen.md">Szene Im Schuhladen</a></p>
<h3 data-heading="**â€žDer Edle Trittâ€œ â€“ Schuhwerk fÃ¼r den feinen Gang**"><strong>â€žDer Edle Trittâ€œ â€“ Schuhwerk fÃ¼r den feinen Gang</strong></h3>
<p>Versteckt zwischen zwei imposanten FachwerkhÃ¤usern im gehobenen Stadtviertel von Gareth findet man â€žDer Edle Trittâ€œ, eine kleine, elegante Boutique, deren kunstvoll geschnitztes Schild ein stilisiertes Paar Lederstiefel auf goldenem Grund zeigt. Der Laden ist ein Refugium fÃ¼r wohlhabende BÃ¼rger, Adelige und Diplomaten, die Wert auf Haltung und Stil legen. Beim Eintreten umfÃ¤ngt einen der warme Duft von gegerbtem Leder, Bienenwachs und RosenÃ¶l. Die WÃ¤nde sind mit Regalen gesÃ¤umt, auf denen sich feinstes Schuhwerk aus unterschiedlichsten Materialien prÃ¤sentiert: hochgeschnÃ¼rte Stiefel mit silbernen Ã–sen, zierliche Slipper mit Goldstickerei, sogar weiche Pantoffeln aus dunkelblauem Samt mit Perlenbesatz.</p>
<p>In der Mitte des Raumes steht ein polierter, niedriger Podest aus dunklem Nussholz, auf dem Kunden ihre Schuhe anprobieren â€“ stets mit einem Spiegel aus echtem Glas daneben, eingefasst in filigranem Messing. Ein leiser Klang von Laute und Cembalo erklingt aus einem kleinen MusikspielgerÃ¤t im Hintergrund und unterstreicht die kultivierte AtmosphÃ¤re.</p>
<p>Der Besitzer, <strong>Meister Rodrigo Terme</strong>, ist ein Mann in den besten Jahren mit sÃ¼dlÃ¤ndischer Eleganz. Sein Haar, pechschwarz und glatt zurÃ¼ckgekÃ¤mmt, rahmt ein schmal geschnittenes, leicht gebrÃ¤untes Gesicht mit feinen ZÃ¼gen. Sein Oberlippenbart ist akkurat gestutzt, seine Bewegungen sind geschmeidig wie ein TÃ¤nzer. Er trÃ¤gt eine cremefarbene Seidenbluse mit hochgestelltem Kragen, darÃ¼ber einen taillierten Gehrock aus moosgrÃ¼nem Brokat mit goldenen FÃ¤den. Seine schmalen Lederstiefel, die er selbst gefertigt hat, glÃ¤nzen wie poliertes Ebenholz. Rodrigo spricht mit sanfter Stimme, wÃ¤hlt seine Worte mit Bedacht und strahlt eine Aura von kultivierter Raffinesse aus.</p>
<p>Ihm zur Seite steht <strong>Magda</strong>, eine resolute, aber freundliche Frau mit krÃ¤ftigem KÃ¶rperbau und rotem Haar, das sie unter einem einfachen LeinenhÃ¤ubchen trÃ¤gt. Sie kÃ¼mmert sich um die Anprobe, misst FÃ¼ÃŸe mit silbernen MaÃŸbÃ¤ndern und kennt jede Nuance der Lederpflege. Ihr Arbeitskittel aus grauem Leinen ist mit einem Gurt versehen, an dem BÃ¼rsten, kleine HÃ¤mmerchen und PoliertÃ¼cher hÃ¤ngen. Ihre Augen blicken stets wach und freundlich, und trotz ihres rauen Tons ist ihre Beratung hervorragend.</p>
<p>Die Schuhe aus dem â€žEdlen Trittâ€œ sind weit mehr als GebrauchsgegenstÃ¤nde. Sie sind ein Versprechen an Stil, Komfort und die subtile Macht, mit jedem Schritt Eindruck zu hinterlassen.</p>
<h3 data-heading="Der Schuster &quot;Zum Tanzenden Firunschuh&quot;">Der Schuster "Zum Tanzenden Firunschuh"</h3>
<p>Nur wenige Schritte entfernt befindet sich die Werkstatt des Schusters Gorbas. Der Geruch von Leder und Bienenwachs dringt bereits auf die StraÃŸe. Im Inneren empfÃ¤ngt den Adligen eine Auslage feinster Schuhe auf polierten Holzregalen.</p>
<p>Meister Gorbas, ein stÃ¤mmiger Thorwaler mit ledernen SchÃ¼rze, verneigt sich tief. Er prÃ¤sentiert verschiedene Modelle: elegante Schnabelschuhe mit extra langen Spitzen, wie sie derzeit am Hofe der KÃ¶nigin von Thorwal getragen werden, robuste Reitstiefel aus gewachstem Ochsenleder und leichte Tanzschuhe aus weichem Ziegenleder aus den Koschbergen.</p>
<p>FÃ¼r den festlichen Anlass empfiehlt er ein Paar Poulaines aus feinstem Maraskanleder in tiefem Schwarz. Die extravagant langen Spitzen werden mit Rosshaar ausgestopft, um ihre Form zu bewahren. Silberne Schnallen, verziert mit dem Symbol des Herren Firun, und feine Stickereien an den Seiten unterstreichen den edlen Charakter.</p>
<p>Gorbas nimmt sorgfÃ¤ltig MaÃŸ und erklÃ¤rt, wie er die Sohlen mit einer dÃ¼nnen Schicht Kork aus den WÃ¤ldern des Windhags polstern wird, um hÃ¶chsten Tragekomfort zu gewÃ¤hrleisten. Er verspricht, die Schuhe rechtzeitig fertigzustellen und persÃ¶nlich zu liefern.</p>
<details data-callout="note" class="callout"><summary><span>Poulaines</span></summary><div>
<p>Poulaines, auch als Schnabelschuhe bekannt, waren eine extravagante Schuhmode des SpÃ¤tmittelalters, die besonders im 15. Jahrhundert ihre BlÃ¼tezeit erlebte. Diese Schuhe zeichneten sich durch folgende Merkmale aus:</p>
<h2 data-heading="Charakteristika der Poulaines">Charakteristika der Poulaines</h2>
<ul>
<li><strong>Extrem verlÃ¤ngerte Schuhspitzen:</strong> Die Vorderteile der Schuhe liefen spitz zu und konnten betrÃ¤chtliche LÃ¤ngen erreichen<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Statussymbol:</strong> Je lÃ¤nger die Schuhspitze, desto hÃ¶her der soziale Status des TrÃ¤gers. Adlige und wohlhabende BÃ¼rger trugen oft die extremsten Formen<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Funktionale Anpassungen:</strong> Bei besonders langen Spitzen mussten diese mit Ketten am Bein befestigt werden, um das Gehen zu erleichtern<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Verbreitung:</strong> Die Mode der Poulaines war in ganz Europa verbreitet, von England bis Italien<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
</ul>
<h2 data-heading="Soziale und kulturelle Bedeutung">Soziale und kulturelle Bedeutung</h2>
<ul>
<li><strong>Symbol fÃ¼r Wohlstand:</strong> Die Ã¼bertriebene LÃ¤nge der Schuhe zeigte, dass der TrÃ¤ger nicht fÃ¼r kÃ¶rperliche Arbeit geeignet war<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Gesetzliche Regulierungen:</strong> In einigen Gebieten wurden sogar Gesetze erlassen, die die maximale LÃ¤nge der Schuhspitzen regulierten<a href="https://www.battlemerchant.com/blog/mittelalterliche-schuhe-die-mode-von-bundschuhen-zu-schnabelschuhen">1</a>.</li>
<li><strong>Modische Innovation:</strong> Poulaines markierten einen HÃ¶hepunkt der mittelalterlichen Schuhmode und beeinflussten spÃ¤tere Schuhdesigns<a href="https://www.historische-schuhe.de/renaissance-pantoffeln-schuhe/">3</a>.</li>
</ul>
<p>Die Poulaines waren mehr als nur Schuhe; sie waren ein bedeutendes Mode- und Statussymbol ihrer Zeit, das die sozialen Hierarchien und den Geschmack der spÃ¤tmittelalterlichen Gesellschaft widerspiegelte.</p>
</div></details>
<h3 data-heading="&quot;Schritt &amp; Tritt&quot; - Schuhmacherei der Extraklasse">"Schritt &amp; Tritt" - Schuhmacherei der Extraklasse</h3>
<p>Am Rosenplatz, dem Zentrum des Garether Handwerksviertels, findet sich die Schuhmacherei "Schritt &amp; Tritt". Das LadengeschÃ¤ft ist von auÃŸen unscheinbar, doch wer eintritt, betritt eine Welt des Luxus und der Handwerkskunst.</p>
<p>Meister Gorbas, ein stÃ¤mmiger Thorwaler mit Ã¼berraschend sanften HÃ¤nden, hat sich hier niedergelassen und seine nordische Handwerkskunst mit mittellÃ¤ndischer Eleganz verbunden. Seine Werkstatt im Untergeschoss ist ein Labyrinth aus Leisten, HÃ¤uten und exotischen Materialien.</p>
<p>Das Einzigartige an "Schritt &amp; Tritt" ist Gorbas' FÃ¤higkeit, Schuhe zu fertigen, die sich der FuÃŸform des TrÃ¤gers anpassen und mit der Zeit "mitwachsen". Er erreicht dies durch eine geheime Mischung aus KrÃ¤utern und Ã–len, mit denen er das Leder behandelt.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Gorbas ein Paar knÃ¶chelhohe Stiefel aus schwarzem Maraskanleder vor. Die Sohlen werden aus mehreren Schichten gefertigt, darunter eine Lage Kork aus den WÃ¤ldern des Windhags fÃ¼r hÃ¶chsten Komfort. Die Schnallen sind aus Silber gefertigt und tragen das Symbol des Adelshauses.</p>
<p>Der Anpassungsprozess ist langwierig und beinhaltet mehrere Anproben, bei denen Gorbas nicht nur MaÃŸ nimmt, sondern auch den Gang des Kunden studiert, um die perfekte Passform zu gewÃ¤hrleisten.</p>
<h2 data-heading="Waffenschmiede">Waffenschmiede</h2>
<h3 data-heading="**â€žZur Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den noblen Anlass**"><strong>â€žZur Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den noblen Anlass</strong></h3>
<p>Unweit der sÃ¼dlichen Stadtmauer von Gareth, dort wo das Grollen von HÃ¤mmern und das GlÃ¼hen der Esse das Stadtbild prÃ¤gen, liegt â€žZur Klingenschmiedeâ€œ, ein Laden wie aus einem Heldenlied. Schon von weitem hÃ¶rt man das rhythmische Klopfen auf Ambosse, riecht die Mischung aus glÃ¼hendem Eisen, Ã–l und Kohle und sieht Funken wie kleine Sterne durch die offene SchmiedetÃ¼r tanzen. Der Laden selbst ist halb Werkstatt, halb Ausstellungsraum. An den WÃ¤nden hÃ¤ngen fein gearbeitete Schwerter, elegante Parierdolche, prunkvolle Harnische und kunstvoll verzierte SÃ¤bel â€“ alle aus der Hand eines wahren Meisters.</p>
<p><strong>Meister Konrad Eisenfaust</strong> ist dieser Meister. Ein HÃ¼ne von einem Mann, mit bronzefarbener, sonnengegerbter Haut, zerzaustem grauschwarzem Haar und einem gewaltigen Vollbart. Seine stahlblauen Augen blicken wachsam und entschlossen, sein ganzer KÃ¶rper wirkt wie aus Eisen geschmiedet. Er trÃ¤gt eine ruÃŸgeschwÃ¤rzte LederschÃ¼rze Ã¼ber einem groben Kettenhemd â€“ eine ungewÃ¶hnliche, aber wirkungsvolle Kombination. Seine Unterarme sind mit alten Schmiedesymbolen tÃ¤towiert, und zahlreiche Brandnarben zeugen von Jahrzehnten im Dienst des Feuers. Auf seinem breiten LedergÃ¼rtel hÃ¤ngen Zangen, Feilen und eine Schmiedehammer-Miniatur als Amulett. Wenn er spricht, ist seine Stimme tief und rau wie das Kratzen von Stahl auf Stein.</p>
<p>An seiner Seite arbeitet <strong>Janko</strong>, sein Lehrling, ein etwa 14-jÃ¤hriger Junge mit wirrem blondem Haar und ruÃŸverschmiertem Gesicht. Trotz seiner Jugend hat er bereits die krÃ¤ftigen Arme eines Handwerkers und den wachen Blick eines KÃ¼nstlers. Sein kurzÃ¤rmliges Leinenhemd ist an den SÃ¤umen ausgefranst, sein Lederschurz voller Gebrauchsspuren, doch seine Bewegungen sind prÃ¤zise. Ein kleiner Hammer hÃ¤ngt an seiner Seite, ein Geschenk des Meisters, das er mit sichtbarem Stolz trÃ¤gt. Seine Hose ist schlicht, sein Gesicht voller Bewunderung fÃ¼r seinen Lehrherrn.</p>
<p>â€žZur Klingenschmiedeâ€œ steht fÃ¼r QualitÃ¤t und Ehre. Die Waffen, die hier entstehen, sind nicht nur Werkzeuge des Kampfes, sondern Kunstwerke â€“ geschaffen mit Feuer, Kraft und Seele. Wer hier ein Schwert ersteht, trÃ¤gt nicht bloÃŸ Stahl an seiner Seite, sondern ein Symbol fÃ¼r Mut, Adel und Meisterschaft.</p>
<h3 data-heading="Der Waffenschmied &quot;Zur Eisernen Rondrafaust&quot;">Der Waffenschmied "Zur Eisernen Rondrafaust"</h3>
<p>Am Stadtrand von Gareth, wo der LÃ¤rm der HÃ¤mmer ungestÃ¶rt erschallen kann, liegt die Schmiede von Meister Ungrimm. Rauch steigt aus der Esse, als der Adlige den ruÃŸgeschwÃ¤rzten Werkstattraum betritt. An den WÃ¤nden hÃ¤ngen blankpolierte Schwerter, Dolche und RÃ¼stungsteile.</p>
<p>Ungrimm, ein bulliger Zwerg mit vernarbten HÃ¤nden, wischt sich den SchweiÃŸ von der Stirn und verneigt sich. Er fÃ¼hrt seinen edlen Kunden zu einer Vitrine mit kunstvoll verzierten Prunkklingen. FÃ¼r den festlichen Anlass empfiehlt er einen eleganten Degen oder deutlich zivilisierter eine Stockdegen in Form von Rondras LÃ¶wenkopf und einem mit Rubinen besetzten Knauf.</p>
<p>Die schlanke Klinge ist aus bestem Zwergenstahl geschmiedet, mehrfach gehÃ¤rtet und so scharf, dass sie ein fallendes Haar spalten kÃ¶nnte. In die Klinge sind filigrane Ornamente und das Wappen des Adligen eingeÃ¤tzt, umrahmt von Runen, die Segen der ZwÃ¶lfgÃ¶tter verheiÃŸen.</p>
<p>Als ErgÃ¤nzung prÃ¤sentiert Ungrimm einen passenden Dolch mit Griff aus Drachenbein und einer wellenfÃ¶rmig geschmiedeten Klinge. Er erklÃ¤rt, dass beide Waffen zwar voll funktionsfÃ¤hig, aber in erster Linie als SchmuckstÃ¼cke und Statussymbole gedacht sind, wÃ¼rdig eines Reichsritters.</p>
<h3 data-heading="Die Waffenkammer &quot;Zum Blutigen Beil&quot;">Die Waffenkammer "Zum Blutigen Beil"</h3>
<p>Am Rande des SÃ¶ldnerviertels von Festum liegt die Waffenkammer von Grimm dem EinÃ¤ugigen. Das GebÃ¤ude gleicht einer Festung, mit dicken Steinmauern und vergitterten Fenstern. Ãœber dem Eingang hÃ¤ngt ein riesiges, rostiges Beil. Der Geruch von Ã–l, Leder und Metall schlÃ¤gt dem Besucher entgegen.</p>
<p>Grimm, ein bulliger Mann mit Augenklappe und zahllosen Narben, begrÃ¼ÃŸt Kunden mit einem grimmigen Nicken. Die WÃ¤nde sind bedeckt mit Waffen aller Art: Vom einfachen Dolch bis zur zweihÃ¤ndigen Kriegsaxt, von der leichten Armbrust bis zum thorwalschen Wurfbeil. In einer Ecke steht eine Sammlung exotischer Waffen aus fernen LÃ¤ndern.</p>
<p>FÃ¼r besonders kampferprobte Kunden Ã¶ffnet Grimm einen versteckten Kellerraum. Hier lagern magische Waffen von groÃŸer Macht: Schwerter, die nie rosten, Ã„xte, die RÃ¼stungen wie Butter durchschneiden, und BÃ¶gen, deren Pfeile ihr Ziel niemals verfehlen. Doch Grimm warnt: Diese Waffen haben oft einen eigenen Willen und sind nicht fÃ¼r schwache GemÃ¼ter geeignet</p>
<h3 data-heading="Thorn Eisinger">Thorn Eisinger</h3>
<h2 data-heading="Hutmacher">Hutmacher</h2>
<h3 data-heading="Der Hutmacher &quot;Zur Traviafedern&quot;">Der Hutmacher "Zur Traviafedern"</h3>
<p>In einem schmucken Fachwerkhaus nahe des Traviatempels residiert Meister Farnwald, der renommierteste Hutmacher Gareths. Sein Laden ist ein Paradies aus Filz, Seide und exotischen Federn. Von der Decke hÃ¤ngen Modelle in allen erdenklichen Formen und Farben, von einfachen FilzhÃ¼ten bis zu extravaganten Kreationen fÃ¼r den Adel.</p>
<p>Farnwald, ein drahtiger Mann mit flinken HÃ¤nden und einem Auge fÃ¼r Details, begrÃ¼ÃŸt den Adligen Ã¼berschwÃ¤nglich. Er prÃ¤sentiert die neuesten Kreationen: breitkrempige HÃ¼te mit wallenden StrauÃŸenfedern aus den EchsensÃ¼mpfen, eng anliegende Barette aus feinstem Samt aus Almada und imposante Federbarets, wie sie derzeit am Hofe der Kaiserin getragen werden.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt er ein Barett aus grÃ¼nem oder schwarzen Samt vor, passend zum Wams. Es wird mit einer kunstvollen goldenen Agraffe geschmÃ¼ckt, in die ein groÃŸer Rubin eingelassen ist, der an das Auge Ingerimms erinnert. Eine lange weiÃŸe Reiherfeder vom GroÃŸen Fluss, soll als krÃ¶nender Abschluss dienen.</p>
<p>Farnwald nimmt sorgfÃ¤ltig MaÃŸ und verspricht, das Barett perfekt an die Kopfform des Adligen anzupassen. Er erklÃ¤rt, wie er den Samt Ã¼ber eine Holzform spannen und in Form bringen wird, bevor er die kostbaren Verzierungen anbringt, die von den besten Goldschmieden Gareths gefertigt wurden.</p>
<p>Mit diesen erlesenen StÃ¼cken von den besten Handwerkern der Kaiserstadt wird der Adlige zweifellos alle Blicke auf sich ziehen und seinem Stand alle Ehre machen, sei es bei einem Fest zu Ehren des Kaisers oder bei einer Audienz im Palast des FÃ¼rsten von Gareth.</p>
<h3 data-heading="&quot;Kronen &amp; Kappen&quot; - Hutmacherei mit Tradition">"Kronen &amp; Kappen" - Hutmacherei mit Tradition</h3>
<p>In einem verschachtelten Fachwerkhaus nahe der Magierakademie residiert die Hutmacherei "Kronen &amp; Kappen". Der Laden erstreckt sich Ã¼ber drei Etagen, jede gefÃ¼llt mit Kopfbedeckungen aller Art, von einfachen Filzkappen bis zu extravaganten FederhÃ¼ten.</p>
<p>Meisterin Firunja, eine exzentrische Frau mit wildem grauem Haar und stets wechselnden HÃ¼ten, fÃ¼hrt das GeschÃ¤ft in vierter Generation. Ihre Kreationen sind in ganz Aventurien bekannt und begehrt.</p>
<p>Die Besonderheit von "Kronen &amp; Kappen" liegt in Firunjas FÃ¤higkeit, HÃ¼te zu erschaffen, die sich dem Wetter anpassen. Durch eine Kombination aus alchemistischen TrÃ¤nken und subtiler Magie kÃ¶nnen ihre HÃ¼te bei Regen wasserabweisend werden oder bei starker Sonne zusÃ¤tzlichen Schatten spenden.</p>
<p>FÃ¼r den Empfang empfiehlt Firunja ein Barett aus dunkelblauem Samt, besetzt mit einer Reiherfeder vom GroÃŸen Fluss. Die Krempe ist mit feinen SilberfÃ¤den bestickt, die in der richtigen Beleuchtung wie Sterne funkeln. Eine dezente Agraffe aus Gold und Saphir hÃ¤lt die Feder an Ort und Stelle.</p>
<p>Die Anpassung des Hutes ist ein faszinierender Prozess, bei dem Firunja nicht nur den Kopfumfang misst, sondern auch die GesichtszÃ¼ge und sogar die PersÃ¶nlichkeit des Kunden in Betracht zieht, um die perfekte Form zu finden.</p>
<h2 data-heading="Juwelier">Juwelier</h2>
<h3 data-heading="&quot;Praiosglanz&quot; - Juwelier und Accessoiremeister">"Praiosglanz" - Juwelier und Accessoiremeister</h3>
<p>Im Herzen des Prachtviertels, nur einen Steinwurf vom Kaiserpalast entfernt, befindet sich "Praiosglanz", ein JuweliergeschÃ¤ft von unvergleichlichem Ruf. Das GebÃ¤ude selbst gleicht einem SchmuckstÃ¼ck, mit einer Fassade aus weiÃŸem Marmor und goldenen Verzierungen.</p>
<p>Meister Aurelius von Grangor, ein distinguierter Herr mit scharfem Blick und ruhigen HÃ¤nden, empfÃ¤ngt seine Kundschaft in einem Salon, der eher einem Thronsaal gleicht. Kristallene Kronleuchter werfen ihr Licht auf Vitrinen voller funkelnder Kostbarkeiten.</p>
<p>Die Einzigartigkeit von "Praiosglanz" liegt in Aurelius' FÃ¤higkeit, Edelsteine mit besonderen Eigenschaften zu schleifen. Durch eine Kombination aus prÃ¤ziser Handwerkskunst und subtiler Magie kÃ¶nnen seine SchmuckstÃ¼cke die Ausstrahlung des TrÃ¤gers verstÃ¤rken oder sogar vor bestimmten magischen EinflÃ¼ssen schÃ¼tzen.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Aurelius eine Garnitur aus mehreren StÃ¼cken vor: Eine feine Goldkette mit einem AnhÃ¤nger, der das Wappen des Adelshauses in Miniatur darstellt, besetzt mit winzigen Diamanten. Dazu passende ManschettenknÃ¶pfe aus WeiÃŸgold, in die Rubine eingelassen sind, die angeblich aus den Minen von Xorlosch stammen.</p>
<p>Die Auswahl und Anpassung der SchmuckstÃ¼cke ist ein zeremonieller Akt. Aurelius studiert nicht nur die Physiognomie des Kunden, sondern auch dessen Aura, um die perfekte Kombination von Metallen und Steinen zu finden, die die natÃ¼rliche PrÃ¤senz des TrÃ¤gers unterstreichen.</p>
<p>Jeder dieser LÃ¤den bietet nicht nur exquisite Waren, sondern auch ein einzigartiges Einkaufserlebnis, das den Besuch zu einem unvergesslichen Teil der Vorbereitung auf den festlichen Empfang macht. Die Meister ihres Fachs verstehen es, die BedÃ¼rfnisse und den Status ihrer adligen Kundschaft zu wÃ¼rdigen und zu bedienen, wodurch jedes erworbene StÃ¼ck zu einem wahren Kunstwerk wird.</p>
<h3 data-heading="Der Juwelier &quot;Zum Funkelnden Stern&quot;">Der Juwelier "Zum Funkelnden Stern"</h3>
<p>In einem prÃ¤chtigen Stadtpalais am Praioshof von Gareth residiert der Juwelier Aurelius von Grangor. Schon der Eingang ist ein Kunstwerk: Eine mit Edelsteinen besetzte TÃ¼r, deren Muster das Firmament nachbildet. Im Inneren empfÃ¤ngt den Besucher der Duft von exotischen RÃ¤ucherwerken und der sanfte Klang einer Kristallharfe.</p>
<p>Aurelius, ein distinguierter Herr mit gepflegtem Silberhaar und scharfem Blick, begrÃ¼ÃŸt seine Kundschaft mit kultivierter ZurÃ¼ckhaltung. In kristallenen Vitrinen prÃ¤sentiert er erlesene SchmuckstÃ¼cke: Diademe aus Mithril, besetzt mit Sternenrubinen aus den Minen von Xorlosch, Colliers aus Mondsilber mit schimmernden Perlen aus den SÃ¼dmeeren und Ringe, deren Edelsteine magisch behandelt wurden, um das Licht der Sterne einzufangen.</p>
<p>FÃ¼r besonders diskrete Kunden Ã¶ffnet Aurelius einen verborgenen Raum, in dem er Artefakte von groÃŸer magischer Macht und zweifelhafter Herkunft aufbewahrt. Hier finden sich Amulette mit geheimnisvollen KrÃ¤ften, Ringe, die ihren TrÃ¤ger vor Zaubern schÃ¼tzen, und Edelsteine, in denen angeblich die Seelen lÃ¤ngst vergangener Helden gebunden sind.</p>
<p>Hier ist eine Liste von fÃ¼nf fiktiven JuwelierlÃ¤den in Gareth, die sich an das mittelalterliche bzw. Rokoko-Setting Aventuriens anpassen. Jeder Laden hat seinen eigenen Stil, Kundschaft und Preissegment.</p>
<h3 data-heading="**Kronen &amp; Karfunkel**"><strong>Kronen &amp; Karfunkel</strong></h3>
<p><strong>Standort:</strong> Alt-Gareth, nahe der Neuen Residenz<br>
<strong>Beschreibung des Ladens:</strong> Kronen &amp; Karfunkel ist ein opulenter Juwelierladen, dessen Schaufenster mit schweren VorhÃ¤ngen aus Brokat verhÃ¼llt sind. Im Inneren glitzern funkelnde Kronleuchter Ã¼ber samtbezogenen Vitrinen, die mit Gold- und Edelsteinschmuck gefÃ¼llt sind. Der Boden besteht aus poliertem Marmor, und ein Sicherheitsmagier bewacht diskret die wertvollen Auslagen.<br>
<strong>Der Juwelier:</strong> Meisterin Elara von Glanzfels ist eine elegante Frau mit grauem Haar, das stets kunstvoll hochgesteckt ist. Sie stammt aus einer alten horasischen Familie und ist bekannt fÃ¼r ihre Expertise bei seltenen Edelsteinen wie Saphiren und Karfunkeln. Elara ist stolz auf ihre diskrete Art und berÃ¤t ihre wohlhabende Kundschaft persÃ¶nlich.<br>
<strong>Angestellte:</strong> Zwei Goldschmiede arbeiten in einer Werkstatt im hinteren Bereich des Ladens an maÃŸgeschneiderten SchmuckstÃ¼cken. Eine VerkÃ¤uferin kÃ¼mmert sich um die PrÃ¤sentation der Ware, wÃ¤hrend ein Lehrling die Vitrinen reinigt und kleinere Reparaturen Ã¼bernimmt.<br>
<strong>Preise und QualitÃ¤t:</strong> Sehr hochpreisig â€“ dieser Laden richtet sich ausschlieÃŸlich an den Adel und reiche HÃ¤ndlerfamilien, die nach Unikaten suchen.</p>
<h3 data-heading="**Der Funkelstein**"><strong>Der Funkelstein</strong></h3>
<p><strong>Standort:</strong> Neu-Gareth, in der NÃ¤he des Theaterviertels<br>
<strong>Beschreibung des Ladens:</strong> Der Funkelstein ist ein lebhafter Laden mit groÃŸen Fenstern, durch die Sonnenlicht auf die Auslagen fÃ¤llt. Die Einrichtung ist hell und freundlich, mit HolzbÃ¶den und farbenfrohen WandgemÃ¤lden, die Szenen aus Rahjas Mythen zeigen. In den Vitrinen finden sich SchmuckstÃ¼cke mit verspielten Designs, oft inspiriert von Blumen oder Tieren.<br>
<strong>Der Juwelier:</strong> Lysandro Goldblatt ist ein charmanter Mann mit einem Faible fÃ¼r extravagante Designs. Er trÃ¤gt selbst oft auffÃ¤lligen Schmuck und liebt es, seine Kundschaft zu beraten â€“ besonders KÃ¼nstler, Schauspieler und wohlhabende BÃ¼rger mit Sinn fÃ¼r KreativitÃ¤t.<br>
<strong>Angestellte:</strong> Zwei junge Goldschmiedinnen arbeiten an individuellen AuftrÃ¤gen, wÃ¤hrend ein Lehrling sich um die Kundenbetreuung kÃ¼mmert. Ein Barde sorgt mit leiser Musik fÃ¼r eine angenehme AtmosphÃ¤re im Laden.<br>
<strong>Preise und QualitÃ¤t:</strong> Oberer Mittelpreisbereich â€“ ideal fÃ¼r Kunden, die etwas Besonderes suchen, ohne ein VermÃ¶gen auszugeben.</p>
<h3 data-heading="**Die Zwergenkrone**"><strong>Die Zwergenkrone</strong></h3>
<p><strong>Standort:</strong> SÃ¼dquartier, nahe dem Zwergenkai<br>
<strong>Beschreibung des Ladens:</strong> Die Zwergenkrone ist ein kompakter Laden mit massiven SteinwÃ¤nden und einer robusten Einrichtung aus dunklem Holz. Die SchmuckstÃ¼cke werden in schweren Eisen-Vitrinen prÃ¤sentiert, die mit filigranen Zwergenrunen verziert sind. Der Fokus liegt auf funktionalem Schmuck wie Siegelringen und Amuletten mit Schutzrunen.<br>
<strong>Der Juwelier:</strong> Borgrim Steinhauer ist ein erfahrener Zwergenschmied mit einem beeindruckenden grauen Bart. Er legt groÃŸen Wert auf Handwerkskunst und Langlebigkeit seiner StÃ¼cke â€“ jedes SchmuckstÃ¼ck soll Generationen Ã¼berdauern. Borgrim ist wortkarg, aber seine Arbeit spricht fÃ¼r sich selbst.<br>
<strong>Angestellte:</strong> Eine zwergische Gesellin hilft bei der Herstellung von SchmuckstÃ¼cken, wÃ¤hrend Borgrims Tochter den Verkauf Ã¼bernimmt. Ein menschlicher Lehrling lernt das Handwerk unter strenger Aufsicht des Meisters.<br>
<strong>Preise und QualitÃ¤t:</strong> Mittelpreisig â€“ exzellente QualitÃ¤t zu fairen Preisen, besonders beliebt bei Handwerkern und pragmatischen BÃ¼rgern.</p>
<h3 data-heading="**Perlen &amp; Prunk**"><strong>Perlen &amp; Prunk</strong></h3>
<p><strong>Standort:</strong> Rosskuppel, im Viertel der HÃ¤ndler<br>
<strong>Beschreibung des Ladens:</strong> Perlen &amp; Prunk ist ein eleganter Laden mit einer Mischung aus FunktionalitÃ¤t und Stil. Die WÃ¤nde sind in warmen Farben gestrichen, und die Auslagen bestehen aus Glasvitrinen auf geschnitzten Holzsockeln. Der Schwerpunkt liegt auf Schmuck aus Silber sowie Perlenketten und Ohrringen â€“ perfekt fÃ¼r wohlhabende HÃ¤ndlerfamilien oder festliche AnlÃ¤sse.<br>
<strong>Der Juwelier:</strong> Roderika Silberglanz ist eine freundliche Frau mittleren Alters mit einem Auge fÃ¼r Details und Trends. Sie reist regelmÃ¤ÃŸig zu MÃ¤rkten in anderen StÃ¤dten, um neue Materialien einzukaufen oder Inspiration fÃ¼r ihre Designs zu finden.<br>
<strong>Angestellte:</strong> Zwei VerkÃ¤uferinnen kÃ¼mmern sich um die Beratung der Kunden, wÃ¤hrend ein Goldschmied im Hinterzimmer Reparaturen durchfÃ¼hrt oder neue StÃ¼cke anfertigt. Ein Laufbursche bringt Bestellungen zu den Kunden nach Hause.<br>
<strong>Preise und QualitÃ¤t:</strong> Moderat â€“ gute QualitÃ¤t zu erschwinglichen Preisen fÃ¼r HÃ¤ndlerfamilien oder BÃ¼rger mittleren Standes.</p>
<h3 data-heading="**Das Smaragdauge**"><strong>Das Smaragdauge</strong></h3>
<p><strong>Standort:</strong> Meilersgrund, am Rande des Marktplatzes<br>
<strong>Beschreibung des Ladens:</strong> Das Smaragdauge ist ein kleiner Laden mit schlichten HolzmÃ¶beln und einer gemÃ¼tlichen AtmosphÃ¤re. Die SchmuckstÃ¼cke sind einfach gehalten â€“ meist Silberringe oder kleine AnhÃ¤nger â€“, aber dennoch geschmackvoll gestaltet. In einer Ecke steht eine Werkbank, an der der Juwelier oft direkt vor den Augen der Kunden arbeitet.<br>
<strong>Der Juwelier:</strong> Thalion GrÃ¼nblick ist ein Halbelf mit geschickten HÃ¤nden und einem ruhigen Wesen. Er liebt es, Geschichten Ã¼ber seine Reisen durch Aventurien zu erzÃ¤hlen, wÃ¤hrend er SchmuckstÃ¼cke repariert oder neue Designs entwirft. Seine SpezialitÃ¤t sind filigrane Arbeiten wie gravierte Ringe oder kleine Amulette mit Naturmotiven.<br>
<strong>Angestellte:</strong> Keine â€“ Thalion arbeitet allein und schÃ¤tzt die persÃ¶nliche Verbindung zu seinen Kunden sehr. Gelegentlich nimmt er einen Lehrling auf, um sein Wissen weiterzugeben.<br>
<strong>Preise und QualitÃ¤t:</strong> GÃ¼nstig â€“ ideal fÃ¼r einfache BÃ¼rger oder Reisende auf der Suche nach einem kleinen Andenken.</p>
<p>Diese fÃ¼nf JuwelierlÃ¤den decken verschiedene Stadtteile Gareths sowie unterschiedliche Preisklassen ab â€“ vom luxuriÃ¶sen Kronjuwel bis hin zum einfachen Silberring fÃ¼r den Alltag!</p>
<h2 data-heading="Barbier">Barbier</h2>
<h3 data-heading="**Der Goldene Kamm**"><strong>Der Goldene Kamm</strong></h3>
<p><strong>Standort:</strong> Alt-Gareth, nahe der Neuen Residenz<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Der Goldene Kamm ist ein prÃ¤chtiger Salon mit vergoldeten Spiegelrahmen, polierten MarmorbÃ¶den und schweren SamtvorhÃ¤ngen. Die Einrichtung strahlt Luxus aus, von den geschnitzten FriseurstÃ¼hlen bis zu den Kristallkaraffen mit duftenden HaarÃ¶len.<br>
<strong>Der Barbier:</strong> Meister Irmlaus Sierra ist ein eleganter Mann mittleren Alters mit einem perfekt gepflegten Schnurrbart. Er ist bekannt fÃ¼r seine hÃ¶fliche Art und sein Talent, Frisuren zu kreieren, die dem neuesten Horas-Trend entsprechen.<br>
<strong>Angestellte:</strong> Drei Lehrlinge kÃ¼mmern sich um einfache Rasuren und HaarwÃ¤schen, wÃ¤hrend eine Alchimistin exklusive Duftmischungen herstellt. Ein Lakai serviert Tee und GebÃ¤ck an die Kundschaft.<br>
<strong>Preise und QualitÃ¤t:</strong> Sehr hochpreisig, aber unÃ¼bertroffen in QualitÃ¤t und Service. Nur die reichsten BÃ¼rger Gareths kÃ¶nnen sich diesen Salon leisten.</p>
<h3 data-heading="**â€žDer Edle Schnittâ€œ â€“ Der Barbier fÃ¼r Lords und Hohe Damen**"><strong>â€žDer Edle Schnittâ€œ â€“ Der Barbier fÃ¼r Lords und Hohe Damen</strong></h3>
<p>Im Herzen der Altstadt von Gareth, zwischen Marmorstatuen und kleinen Springbrunnen, steht ein Haus mit rot-weiÃŸem Stangenschild, das in spiralfÃ¶rmigem Muster Ã¼ber dem Eingang hÃ¤ngt. Der Laden trÃ¤gt den klangvollen Namen â€žDer Edle Schnittâ€œ und gilt unter Kennern als der Ort, an dem Haar, Bart und Haut mit hÃ¶chster Sorgfalt gepflegt werden. Der Eingangsbereich gleicht mehr einem Salon als einem Handwerksbetrieb: vergoldete Spiegel an den WÃ¤nden, weiche StÃ¼hle aus Mahagoni mit tiefgrÃ¼ner Polsterung und kleine Kristallleuchter, die ein warmes, sanftes Licht spenden.</p>
<p>Der Innenraum ist erfÃ¼llt vom Duft edler Pomaden, ZedernÃ¶l und feinen Rasierseifen. Instrumente aus Silber und Messing glÃ¤nzen ordentlich aufgereiht auf dunklen Ablagen: Scheren, Rasiermesser, BÃ¼rsten, glÃ¤serne Phiolen mit duftenden Essenzen. Im Hintergrund spielt leise eine Spieluhr eine alte aranische Melodie. Kunden, die hierherkommen, suchen nicht nur Pflege, sondern auch Prestige.</p>
<p><strong>Barbier Amando Calvero</strong> ist der unangefochtene Herr Ã¼ber Schere und Klinge. Von mittlerer GrÃ¶ÃŸe, mit olivfarbener Haut, fein geschwungenem Bart und dunklen, klugen Augen, bewegt er sich mit einer Eleganz, als tanze er durch seinen Laden. Sein Haar ist zu einem perfekten Knoten hochgebunden, ein Seidenband in Purpur hÃ¤lt es in Form. Er trÃ¤gt eine taillierte schwarze Weste mit goldener Stickerei, ein weiÃŸes Hemd mit RÃ¼schenmanschetten und ein langes, schimmerndes Halstuch in Mitternachtsblau. Seine Stimme ist weich, fast flÃ¼sternd, und er spricht mit dem Timbre eines BÃ¼hnenkÃ¼nstlers. Wenn er den Rasierpinsel schwingt oder mit dem Tuch um das Gesicht eines Kunden fÃ¤hrt, tut er das mit beinahe priesterlicher Andacht.</p>
<p>UnterstÃ¼tzt wird er von <strong>Serafin</strong>, einem schlaksigen, jungen Mann mit blassem Teint und hellblonden Locken, der fÃ¼r Ordnung, Duftmischungen und Haarpflegeprodukte zustÃ¤ndig ist. Er trÃ¤gt ein blassviolettes Arbeitsgewand mit seidigem Glanz und spricht stets hÃ¶flich, fast unterwÃ¼rfig. Daneben arbeitet <strong>Lysandra</strong>, eine rothaarige, energische Gesellin, die sich auf Damenfrisuren und ParfÃ¼merie versteht. Sie trÃ¤gt ein elegantes, aber praktisches Kleid mit SpitzenschÃ¼rze, stets parfÃ¼miert mit Lavendel.</p>
<p>â€žDer Edle Schnittâ€œ ist kein gewÃ¶hnlicher Barbier â€“ er ist ein Ort der Verwandlung, wo ein einfacher BÃ¼rger als Edelmann den Laden verlÃ¤sst. Jedes Rasieren wird zur Zeremonie, jeder Haarschnitt zum Kunstwerk, und selbst die leiseste BerÃ¼hrung wird zur Geste kultivierter Macht.</p>
<h3 data-heading="**Bart &amp; Klinge**"><strong>Bart &amp; Klinge</strong></h3>
<p><strong>Standort:</strong> Meilersgrund, im Viertel der Handwerker<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Eine rustikale Werkstatt mit Holzbalken und einem groÃŸen Kamin. Die AtmosphÃ¤re ist gemÃ¼tlich, und der Duft von KrÃ¤utern liegt in der Luft. An den WÃ¤nden hÃ¤ngen Zunftzeichen und alte Barbierwerkzeuge.<br>
<strong>Der Barbier:</strong> Gerwin Hartholz ist ein krÃ¤ftiger Mann mit wettergegerbter Haut und einem dichten Vollbart. Er ist bekannt fÃ¼r seine prÃ¤zisen Rasuren und seine FÃ¤higkeit, auch bei schwierigen Kunden ruhig zu bleiben.<br>
<strong>Angestellte:</strong> Zwei Gesellen helfen bei der Arbeit, wÃ¤hrend Gerwins Frau KrÃ¤uteraufgÃ¼sse fÃ¼r die Rasur vorbereitet. Ein Lehrling kÃ¼mmert sich um das AufrÃ¤umen und das SchÃ¤rfen der Klingen.<br>
<strong>Preise und QualitÃ¤t:</strong> Mittelpreisig mit solider QualitÃ¤t â€“ ideal fÃ¼r Handwerker und BÃ¼rger mittleren Standes.</p>
<h3 data-heading="**Rahjas Spiegel**"><strong>Rahjas Spiegel</strong></h3>
<p><strong>Standort:</strong> Neu-Gareth, nahe dem Rahja-Tempel<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Ein farbenfroher Salon mit seidenen VorhÃ¤ngen und duftenden Blumenarrangements. Die Einrichtung ist verspielt und romantisch, mit kunstvoll bemalten Spiegeln und weichen Polstern auf den StÃ¼hlen.<br>
<strong>Der Barbier:</strong> Lysandra von BlÃ¼tenhain ist eine charmante junge Frau mit einem Hang zur Extravaganz. Sie spezialisiert sich auf kunstvolle Flechtfrisuren und HaarfÃ¤rbungen in ungewÃ¶hnlichen Farben.<br>
<strong>Angestellte:</strong> Zwei Friseurinnen unterstÃ¼tzen Lysandra bei ihrer Arbeit, wÃ¤hrend ein Musiker leise Laute spielt, um die Kundschaft zu unterhalten.<br>
<strong>Preise und QualitÃ¤t:</strong> Oberer Mittelpreisbereich â€“ besonders beliebt bei KÃ¼nstlern, Schauspielern und wohlhabenden BÃ¼rgern.</p>
<h3 data-heading="**Der Rasierstein**"><strong>Der Rasierstein</strong></h3>
<p><strong>Standort:</strong> SÃ¼dquartier, nahe dem Viehmarkt<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Eine schlichte Werkstatt mit robusten HolzmÃ¶beln und einem groÃŸen Fenster zur StraÃŸe hin. Die Einrichtung ist funktional, aber sauber gehalten.<br>
<strong>Der Barbier:</strong> Borik Eisenbart ist ein Ã¤lterer Zwerg mit einer Vorliebe fÃ¼r klare Schnitte und praktische Frisuren. Er ist bekannt fÃ¼r seine Effizienz und seine robuste Art im Umgang mit Kunden.<br>
<strong>Angestellte:</strong> Keine â€“ Borik arbeitet allein, da er niemandem auÃŸer sich selbst vertraut, wenn es um das SchÃ¤rfen seiner Klingen geht.<br>
<strong>Preise und QualitÃ¤t:</strong> GÃ¼nstig mit guter QualitÃ¤t â€“ perfekt fÃ¼r einfache BÃ¼rger oder Reisende.</p>
<h3 data-heading="**Die Garether Schere**"><strong>Die Garether Schere</strong></h3>
<p><strong>Standort:</strong> Rosskuppel, im Viertel der HÃ¤ndler<br>
<strong>Beschreibung des Arbeitsplatzes:</strong> Ein moderner Salon mit groÃŸen Fenstern, durch die Sonnenlicht auf die polierten HolzfuÃŸbÃ¶den fÃ¤llt. Die Einrichtung kombiniert FunktionalitÃ¤t mit Stil; es gibt bequeme StÃ¼hle und eine kleine Bibliothek fÃ¼r wartende Kunden.<br>
<strong>Der Barbier:</strong> Roderick Feinhand ist ein junger Mann mit einem scharfen Auge fÃ¼r Details und einer Leidenschaft fÃ¼r neue Techniken. Er bietet auch Bartpflegeprodukte an, die er selbst herstellt.<br>
<strong>Angestellte:</strong> Eine Assistentin fÃ¼hrt Buch Ã¼ber Termine, wÃ¤hrend zwei Lehrlinge einfache Aufgaben Ã¼bernehmen wie das FÃ¶hnen oder das Reinigen der Werkzeuge.<br>
<strong>Preise und QualitÃ¤t:</strong> Moderat â€“ ideal fÃ¼r HÃ¤ndler oder BÃ¼rger mittleren Standes, die Wert auf Stil legen.</p>
<p>Diese Liste bietet eine Auswahl an Barbieren in Gareth, die verschiedene Stadtteile abdecken sowie unterschiedliche Preisklassen bedienen â€“ vom luxuriÃ¶sen Salon bis zur einfachen Werkstatt fÃ¼r den Alltagshandwerker oder Reisenden.</p>
<hr>
<h1 data-heading="Weitere LÃ¤den">Weitere LÃ¤den</h1>
<h3 data-heading="&quot;Hesindenspiegel&quot; - Intellektuelle Raffinesse">"Hesindenspiegel" - Intellektuelle Raffinesse</h3>
<p>In einem verschachtelten Fachwerkhaus nahe der Magierakademie findet sich "Hesindenspiegel". Die Fassade ist mit mathematischen und astrologischen Symbolen verziert.</p>
<p>Der Schneidermagier Theoban Sterndeuter, ein hagerer Mann mit funkelnden Augen, fÃ¼hrt das GeschÃ¤ft. Der Laden gleicht einer Bibliothek, mit BÃ¼cherregalen und magischen Artefakten zwischen den KleidungsstÃ¼cken.</p>
<p>"Hesindenspiegel" kreiert GewÃ¤nder fÃ¼r den intellektuellen Adel:</p>
<ul>
<li>Roben mit eingewebten, subtil leuchtenden Runen</li>
<li>UmhÃ¤nge, deren Muster sich je nach Lichteinfall in komplexe magische Diagramme verwandeln</li>
<li>Accessoires, die magische Effekte imitieren, wie Kragen, die einen Hauch von Sternenglanz verstrÃ¶men</li>
</ul>
<p>Diese Kleidung soll die TrÃ¤ger als Meister des Wissens und der arkanen KÃ¼nste prÃ¤sentieren.</p>
<h3 data-heading="Die KrÃ¤uterhandlung &quot;Zum Duftenden Alraun&quot;">Die KrÃ¤uterhandlung "Zum Duftenden Alraun"</h3>
<p>In einer verwinkelten Gasse des Hexenviertels von Havena liegt der Laden der KrÃ¤uterhexe Morla. Ein verwilderter Vorgarten voller seltsamer Pflanzen fÃ¼hrt zu einer schiefen HolztÃ¼r, Ã¼ber der ein ausgestopfter Rabe wacht. Der Innenraum ist ein Labyrinth aus Regalen, KÃ¶rben und von der Decke hÃ¤ngenden KrÃ¤uterbÃ¼ndeln.</p>
<p>Morla, eine alte Frau mit wildem grauem Haar und durchdringenden grÃ¼nen Augen, mustert jeden Kunden misstrauisch. Der Raum ist erfÃ¼llt vom Duft getrockneter KrÃ¤uter, exotischer GewÃ¼rze und mysteriÃ¶ser Essenzen. In GlÃ¤sern und Tiegeln finden sich seltene Ingredienzien: Drachenblut aus den Salamandersteine, Alraunenwurzeln aus dem Reichsforst und LotusblÃ¼ten aus den EchsensÃ¼mpfen.</p>
<p>FÃ¼r vertrauenswÃ¼rdige Kunden hÃ¤lt Morla besondere SchÃ¤tze bereit: TrÃ¤nke, die Visionen hervorrufen, Salben, die Wunden in Stunden heilen lassen, und Pulver, die angeblich Tote zum Leben erwecken kÃ¶nnen. Doch Vorsicht ist geboten - Morlas Waren sind mÃ¤chtig, aber oft mit unerwarteten Nebenwirkungen behaftet.</p>
<h3 data-heading="Die Schreibstube &quot;Zur Singenden Feder&quot;">Die Schreibstube "Zur Singenden Feder"</h3>
<p>In einem stillen Winkel des Hesindeviertels von Kuslik befindet sich die Schreibstube von Meister Fidelius. Ein zierlicher Turm aus weiÃŸem Marmor beherbergt den Laden, dessen Fenster mit buntem Glas verziert sind. Im Inneren herrscht eine AtmosphÃ¤re konzentrierter Stille, nur unterbrochen vom Kratzen der Federn auf Pergament.</p>
<p>Fidelius, ein hagerer Mann mit Nickelbrille und tintenbefleckten Fingern, empfÃ¤ngt Besucher mit einem zerstreuten LÃ¤cheln. Regale voller BÃ¼cher, Schriftrollen und Manuskripte sÃ¤umen die WÃ¤nde. Auf polierten Schreibpulten liegen Federn aus exotischen VÃ¶geln, TintenfÃ¤sser mit schimmernden Farben und Pergamente aus feinstem Kalbsleder.</p>
<p>FÃ¼r besondere Kunden bietet Fidelius auÃŸergewÃ¶hnliche Dienste an: Magische Tinte, die nur vom EmpfÃ¤nger gelesen werden kann, Pergamente, auf denen die Schrift von selbst erscheint, und BÃ¼cher, deren Inhalt sich dem Wissen des Lesers anpasst. Doch Vorsicht ist geboten - manche dieser magischen Schriften haben ein Eigenleben entwickelt und kÃ¶nnen unvorsichtige Leser in ihren Bann ziehen.</p>
<p>Gerne platziere ich die vier neuen LÃ¤den in Gareth und passe ihre Charakteristiken entsprechend an:</p>
<h3 data-heading="&quot;Schattenschneider&quot; - Diskrete Gewandungen im SÃ¼dquartier">"Schattenschneider" - Diskrete Gewandungen im SÃ¼dquartier</h3>
<p>Im SÃ¼dquartier Gareths, bekannt fÃ¼r seine verwinkelten Gassen und schattigen Ecken, verbirgt sich der Laden des "Schattenschneiders" hinter einer unscheinbaren Fassade. Ein kompliziertes System von Spiegeln und Schatten macht es fast unmÃ¶glich, den Eingang zu finden, wenn man nicht das richtige Losungswort kennt.</p>
<p>Der Besitzer, ein namenloser Schatten, der angeblich einst zur Garde des Kaisers gehÃ¶rte, kommuniziert nur durch geflÃ¼sterte Worte und subtile Gesten. Der Raum ist in ewiges Zwielicht getaucht, Ã¤hnlich den geheimen GÃ¤ngen des Kaiserpalastes.</p>
<p>Hier findet man Kleidung fÃ¼r jene, die in Gareth ungesehen bleiben wollen: UmhÃ¤nge, die jedes GerÃ¤usch der geschÃ¤ftigen StraÃŸen dÃ¤mpfen, Stiefel mit Sohlen, die keine Spuren auf den staubigen Pflastersteinen hinterlassen, und Masken, die das Gesicht des TrÃ¤gers den Schatten der Stadt anpassen.</p>
<p>FÃ¼r die Elite der Garether Unterwelt und diskrete Adlige bietet der Schattenschneider besondere Dienste: GewÃ¤nder, die es erlauben, durch die Schatten der PalÃ¤ste zu gleiten, Handschuhe, die jedes Siegel unbemerkt Ã¶ffnen, oder Kopfbedeckungen, die Gedanken vor den Magiern des Hofes verbergen.</p>
<h3 data-heading="&quot;Metamorphosenschneiderei&quot; - Verwandelnde Gewandungen im Magieviertel">"Metamorphosenschneiderei" - Verwandelnde Gewandungen im Magieviertel</h3>
<p>In einem schiefen Turm am Rande des Magierviertels von Gareth, nicht weit von der berÃ¼hmten Akademie der Magischen RÃ¼stung, befindet sich die "Metamorphosenschneiderei". Das GebÃ¤ude scheint sich dem Rhythmus der magischen Energien der Stadt anzupassen, und die TÃ¼r erscheint tÃ¤glich an einer anderen Stelle der Fassade.</p>
<p>Der Besitzer, der exzentrische Magier Zoltan von Gareth, ist ein Mann mit wildem Haar und Kleidung, die sich stÃ¤ndig in Farbe und Form verÃ¤ndert, passend zu den wechselnden Stimmungen der Kaiserstadt. In seinem Laden schweben Stoffe frei durch die Luft, und Kleider wechseln selbststÃ¤ndig ihre Gestalt, inspiriert von den magischen Experimenten der nahen Akademie.</p>
<p>Zoltan spezialisiert sich auf Kleidung, die sich den BedÃ¼rfnissen des hektischen Lebens in Gareth anpassen kann: MÃ¤ntel, die sich von formeller Hofkleidung in praktische ReisegewÃ¤nder verwandeln, Kleider, die ihre Farbe und ihren Schnitt je nach politischer Situation am Hof anpassen, oder HÃ¼te, die sich in Helme verwandeln kÃ¶nnen, sollte man in eine der berÃ¼chtigten Garether StraÃŸenschlÃ¤gereien geraten.</p>
<p>FÃ¼r besonders einflussreiche Kunden, wie hohe Beamte oder Mitglieder des Magierkollegiums, erschafft Zoltan Meisterwerke der Verwandlungskunst: GewÃ¤nder, die es dem TrÃ¤ger erlauben, sich unauffÃ¤llig durch verschiedene gesellschaftliche Schichten zu bewegen, Schuhe, die Treppen in den hÃ¶chsten TÃ¼rmen der Stadt mÃ¼helos erklimmen, oder Handschuhe, die jedes Dokument in eine fÃ¼r den TrÃ¤ger vorteilhafte Version verwandeln kÃ¶nnen.</p>
<p>Diese vier LÃ¤den bieten eine breite Palette an einzigartigen EinkleidungsmÃ¶glichkeiten, jeder perfekt an die komplexe politische, soziale und magische Landschaft Gareths angepasst.</p>
<h3 data-heading="&quot;Farbenzauber&quot; - StoffÃ¤rberei und Musterweberei">"Farbenzauber" - StoffÃ¤rberei und Musterweberei</h3>
<p>In einem bunten Fachwerkhaus am Ufer des GroÃŸen Flusses befindet sich "Farbenzauber". Der Laden ist von einem Garten umgeben, in dem seltene Pflanzen fÃ¼r Farbstoffe kultiviert werden.</p>
<p>Meisterin Iris Buntweberin, eine lebhafte Frau mit farbbefleckten HÃ¤nden und stets wechselnden Haarfarben, leitet das GeschÃ¤ft. Ihre Werkstatt ist ein Labyrinth aus FÃ¤rbebottichen, WebstÃ¼hlen und Trockengestellen.</p>
<p>Das Besondere an "Farbenzauber" ist Iris' FÃ¤higkeit, Stoffe zu fÃ¤rben, die ihre Farbe je nach Licht oder Stimmung des TrÃ¤gers Ã¤ndern kÃ¶nnen. Sie erreicht dies durch eine Kombination aus alchemistischen FÃ¤rbemitteln und feiner Illusionsmagie.</p>
<p>FÃ¼r den festlichen Empfang empfiehlt Iris einen Stoff, der tagsÃ¼ber in einem tiefen Blau schimmert, bei Kerzenlicht jedoch einen purpurnen Glanz annimmt. Das eingewebte Muster zeigt subtile Szenen aus der Geschichte des Adelshauses, die nur aus bestimmten Blickwinkeln sichtbar werden.</p>
<p>Der Auswahlprozess gleicht einer Farbberatung, bei der Iris nicht nur die Hautfarbe und Haarfarbe des Kunden berÃ¼cksichtigt, sondern auch dessen PersÃ¶nlichkeit und die gewÃ¼nschte Wirkung bei Hofe.</p>
<h3 data-heading="&quot;Glanzgestalt&quot; - Magische Kosmetik und ParfÃ¼merie">"Glanzgestalt" - Magische Kosmetik und ParfÃ¼merie</h3>
<p>In einem eleganten Stadthaus nahe des Hesindetempels findet sich "Glanzgestalt". Der Laden duftet nach exotischen Essenzen und schillert in allen Farben des Regenbogens.</p>
<p>Meister Lucius von Spiegel, ein gepflegter Mann mit hypnotisierenden Augen, fÃ¼hrt das GeschÃ¤ft mit der PrÃ¤zision eines Alchemisten. Sein Labor im Keller ist ein Wunderwerk aus Destillierapparaten und magischen Artefakten.</p>
<p>Die Einzigartigkeit von "Glanzgestalt" liegt in Lucius' FÃ¤higkeit, Kosmetika und DÃ¼fte zu kreieren, die nicht nur das Ã„uÃŸere, sondern auch die Aura des TrÃ¤gers verfeinern. Seine Kreationen kÃ¶nnen subtil die Wahrnehmung anderer beeinflussen oder sogar vor magischer Beeinflussung schÃ¼tzen.</p>
<p>FÃ¼r den Empfang empfiehlt Lucius ein maÃŸgeschneidertes ParfÃ¼m, das den natÃ¼rlichen Duft des TrÃ¤gers verstÃ¤rkt und gleichzeitig eine Aura von AutoritÃ¤t und VertrauenswÃ¼rdigkeit verstrÃ¶mt. Dazu eine Gesichtscreme, die feine Linien verschwinden lÃ¤sst und der Haut einen Ã¼bernatÃ¼rlichen Glanz verleiht.</p>
<p>Die Anpassung der Produkte ist ein intimer Prozess, bei dem Lucius nicht nur die Haut und den KÃ¶rpergeruch analysiert, sondern auch die PersÃ¶nlichkeit und die Ziele des Kunden berÃ¼cksichtigt.</p>
<h3 data-heading="&quot;Federkiel &amp; Tinte&quot; - Kalligraphie und Siegelkunst">"Federkiel &amp; Tinte" - Kalligraphie und Siegelkunst</h3>
<p>In einem schmalen Turm im Gelehrtenviertel residiert "Federkiel &amp; Tinte". Der Laden ist ein Paradies fÃ¼r Schreibkundige, mit Regalen voller Schreibfedern, Tinten in allen Farben und edlen Papieren.</p>
<p>Meisterin Serena SchÃ¶nschrift, eine zierliche Frau mit tintenbefleckten Fingern und scharfen Augen, fÃ¼hrt das GeschÃ¤ft mit der PrÃ¤zision einer Uhrmacherin. Ihre Werkstatt im obersten Stockwerk bietet einen atemberaubenden Blick Ã¼ber Gareth.</p>
<p>Das Besondere an "Federkiel &amp; Tinte" ist Serenas FÃ¤higkeit, magische Siegel und Unterschriften zu kreieren, die nicht gefÃ¤lscht werden kÃ¶nnen und sogar versteckte Botschaften enthalten kÃ¶nnen. Sie kombiniert traditionelle Kalligraphie mit feiner Runenzauberei.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Serena ein personalisiertes Siegel vor, das nicht nur das Wappen des Adelshauses zeigt, sondern auch subtil die Tugenden des TrÃ¤gers symbolisiert. Dazu eine Tinte, die auf normalem Papier schwarz erscheint, auf speziell prÃ¤pariertem Papier jedoch in den Hausfarben schimmert.</p>
<p>Die Erstellung des Siegels und der Tinte ist ein langwieriger Prozess, bei dem Serena die Familiengeschichte, persÃ¶nliche Errungenschaften und zukÃ¼nftige Ambitionen des Kunden in ihr Design einflieÃŸen lÃ¤sst.</p>
<h3 data-heading="&quot;Zeitlose Eleganz&quot; - Uhrmacherei und magische Zeitmesser">"Zeitlose Eleganz" - Uhrmacherei und magische Zeitmesser</h3>
<p>In einem Uhrenturm am Rande des Magierviertels befindet sich "Zeitlose Eleganz". Der Laden ist erfÃ¼llt vom sanften Ticken unzÃ¤hliger Uhren und dem Glitzern feinster Mechanismen.</p>
<p>Meister Chronos von Stundenglas, ein Mann mit silbernem Haar und stets prÃ¤zisen Bewegungen, leitet das GeschÃ¤ft mit der Genauigkeit seiner Uhren. Seine Werkstatt im obersten Stockwerk des Turms ist ein Wunderwerk der Feinmechanik und magischen Zeitmessung.</p>
<p>Die Einzigartigkeit von "Zeitlose Eleganz" liegt in Chronos' FÃ¤higkeit, Uhren zu erschaffen, die mehr als nur die Zeit anzeigen. Seine Kreationen kÃ¶nnen gÃ¼nstige Zeitpunkte fÃ¼r wichtige Entscheidungen anzeigen, vor Gefahren warnen oder sogar kurzfristig die Zeit fÃ¼r den TrÃ¤ger verlangsamen.</p>
<p>FÃ¼r den Empfang empfiehlt Chronos eine Taschenuhr aus Mithril, deren Zifferblatt die Sternenkonstellation zum Zeitpunkt der Geburt des TrÃ¤gers zeigt. Die Uhr kann nicht nur die genaue Zeit, sondern auch die Stimmung im Raum und die Aufrichtigkeit von GesprÃ¤chspartnern anzeigen.</p>
<p>Die Anfertigung einer solchen Uhr ist ein komplexer Prozess, der Wochen dauern kann und bei dem Chronos nicht nur die technischen Aspekte, sondern auch die astrologischen und persÃ¶nlichen Faktoren des Kunden berÃ¼cksichtigt.</p>
<h3 data-heading="&quot;Spiegelbild&quot; - Magische Spiegel und Illusionskunst">"Spiegelbild" - Magische Spiegel und Illusionskunst</h3>
<p>In einem schimmernden Kristallpalast im Herzen des Magierviertels befindet sich "Spiegelbild". Der Laden selbst scheint aus Tausenden von Spiegeln zu bestehen, die das Licht in faszinierenden Mustern reflektieren.</p>
<p>Meisterin Luna Silberblick, eine Ã¤therische Erscheinung mit silbernen Augen, fÃ¼hrt das GeschÃ¤ft mit der Anmut einer TÃ¤nzerin. Ihr Atelier im Zentrum des Kristallpalastes ist ein Kaleidoskop aus Licht und Illusion.</p>
<p>Das Besondere an "Spiegelbild" ist Lunas FÃ¤higkeit, Spiegel zu erschaffen, die mehr zeigen als nur das Spiegelbild. Ihre Kreationen kÃ¶nnen vergangene oder zukÃ¼nftige Versionen des Betrachters zeigen, verborgene Wahrheiten enthÃ¼llen oder sogar als Portale zu anderen Orten dienen.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Luna einen Handspiegel vor, der dem TrÃ¤ger stets sein bestes Selbst zeigt und subtile Hinweise gibt, wie dieses Ideal erreicht werden kann. ZusÃ¤tzlich bietet sie eine Brosche mit einem winzigen Spiegel an, der vor feindseligen Absichten in der Umgebung warnt.</p>
<p>Die Erschaffung dieser magischen Spiegel ist ein faszinierender Prozess, bei dem Luna nicht nur die physische Erscheinung des Kunden studiert, sondern auch tief in dessen Seele blickt, um die wahren WÃ¼nsche und Ã„ngste zu erkennen.</p>
<h3 data-heading="&quot;Klangweber&quot; - Magische Musikinstrumente und Klangzauber">"Klangweber" - Magische Musikinstrumente und Klangzauber</h3>
<p>In einem melodisch summenden Turm am Rande des KÃ¼nstlerviertels befindet sich "Klangweber". Der Laden ist erfÃ¼llt von sanfter Musik, die aus unsichtbaren Quellen zu kommen scheint.</p>
<p>Meister Harmonius Wohlklang, ein Mann mit einem LÃ¤cheln so warm wie Sonnenschein und Fingern so flink wie KolibriflÃ¼gel, leitet das GeschÃ¤ft. Seine Werkstatt im obersten Stockwerk ist ein Symphonie aus Instrumenten, Klangschalen und vibrierenden Kristallen.</p>
<p>Die Einzigartigkeit von "Klangweber" liegt in Harmonius' FÃ¤higkeit, Instrumente zu erschaffen, die nicht nur Musik spielen, sondern auch Emotionen beeinflussen oder sogar subtile Magie wirken kÃ¶nnen. Seine Kreationen kÃ¶nnen RÃ¤ume mit positiver Energie fÃ¼llen, LÃ¼gen entlarven oder sogar kleine Wunder bewirken.</p>
<p>FÃ¼r den Empfang empfiehlt Harmonius eine FlÃ¶te aus Mondholz, die, wenn gespielt, eine Aura der Gelassenheit und des Wohlwollens verbreitet. ZusÃ¤tzlich bietet er eine Stimmgabel an, die, wenn angeschlagen, disharmonische Energien in der Umgebung neutralisieren kann.</p>
<p>Die Erschaffung dieser magischen Instrumente ist ein langwieriger Prozess, bei dem Harmonius nicht nur die musikalischen FÃ¤higkeiten des Kunden berÃ¼cksichtigt, sondern auch dessen emotionale Landschaft und spirituelle Resonanz.</p>
<h3 data-heading="&quot;Schattenschneider&quot; - Magische Beleuchtung und Schattenkunst">"Schattenschneider" - Magische Beleuchtung und Schattenkunst</h3>
<p>In einem dÃ¼steren, aber eleganten GebÃ¤ude nahe des Phex-Tempels befindet sich "Schattenschneider". Der Laden ist ein faszinierendes Spiel aus Licht und Schatten, wo Dunkelheit und Helligkeit in perfekter Harmonie zu existieren scheinen.</p>
<p>Meisterin Umbra Nachtkind, eine schlanke Frau mit rabenschwarzen Haaren und Augen, die im Dunkeln zu leuchten scheinen, fÃ¼hrt das GeschÃ¤ft. Ihr Atelier im Keller ist ein Labyrinth aus Lichtquellen, Schattenformen und optischen Illusionen.</p>
<p>Das Besondere an "Schattenschneider" ist Umbras FÃ¤higkeit, Beleuchtung und Schatten zu manipulieren, um subtile magische Effekte zu erzielen. Ihre Kreationen kÃ¶nnen RÃ¤ume grÃ¶ÃŸer erscheinen lassen, unerwÃ¼nschte Aufmerksamkeit ablenken oder sogar Botschaften in Schatten verbergen.</p>
<p>FÃ¼r den festlichen Anlass schlÃ¤gt Umbra eine Brosche vor, die das Licht um den TrÃ¤ger herum so manipuliert, dass er stets im besten Licht erscheint. ZusÃ¤tzlich bietet sie einen SchattenfÃ¤cher an, der bei Bedarf einen Bereich der PrivatsphÃ¤re um den Benutzer herum erzeugen kann.</p>
<p>Die Erschaffung dieser Licht- und Schattenartefakte ist ein faszinierender Prozess, bei dem Umbra nicht nur die physische Erscheinung des Kunden studiert, sondern auch dessen PersÃ¶nlichkeit und die gewÃ¼nschte Wirkung in verschiedenen sozialen Situationen berÃ¼cksichtigt.</p>
<p>Jeder dieser LÃ¤den bietet nicht nur auÃŸergewÃ¶hnliche Waren, sondern auch ein einzigartiges Einkaufserlebnis, das den Besuch zu einem unvergesslichen Teil der Vorbereitung auf den festlichen Empfang macht. Die Meister ihres Fachs verstehen es, die BedÃ¼rfnisse und den Status ihrer adligen Kundschaft zu wÃ¼rdigen und zu bedienen, wodurch jedes erworbene StÃ¼ck zu einem wahren Kunstwerk mit magischer Raffinesse wird.</p>
<h1 data-heading="Weitere LÃ¤den aus ChatGPT">Weitere LÃ¤den aus ChatGPT</h1>
<h3 data-heading="1. **â€žDer Goldene Fadenâ€œ â€“ GewÃ¤nder fÃ¼r den Hof**">1. <strong>â€žDer Goldene Fadenâ€œ â€“ GewÃ¤nder fÃ¼r den Hof</strong></h3>
<p>In einer ruhigen Seitengasse des Adelsviertels von Gareth befindet sich â€žDer Goldene Fadenâ€œ, ein exklusives Modehaus, das fÃ¼r seine meisterhaft gefertigten GewÃ¤nder bekannt ist. Die Fassade des GebÃ¤udes ist mit kunstvollen Schnitzereien verziert, die Szenen aus der Geschichte des Mittelreichs darstellen. GroÃŸe Fenster erlauben Passanten einen Blick auf die prÃ¤chtigen Stoffe und KleidungsstÃ¼cke im Inneren.</p>
<p>Beim Betreten des Ladens wird man von einem dezenten Duft nach Lavendel und feinem ParfÃ¼m empfangen. Die InnenrÃ¤ume sind mit edlen HÃ¶lzern vertÃ¤felt, und Kronleuchter aus Kristall werfen ein warmes Licht auf die ausgestellten KleidungsstÃ¼cke. Auf goldenen StÃ¤ndern hÃ¤ngen Roben aus Seide, Brokat und Samt, verziert mit Stickereien und Edelsteinen.</p>
<p><strong>Besitzerin:</strong> <em>Madame Elenora von Arkenstein</em> ist eine elegante Dame mittleren Alters mit silbernem Haar, das zu einem kunstvollen Knoten frisiert ist. Sie trÃ¤gt stets ein maÃŸgeschneidertes Kleid aus dunkelblauem Samt, das ihre schlanke Figur betont. Ihre Augen sind von einem intensiven GrÃ¼n, und ihr Auftreten ist von einer natÃ¼rlichen AutoritÃ¤t geprÃ¤gt.</p>
<p><strong>Angestellte:</strong> <em>Lina</em>, eine junge Schneiderin mit flinken Fingern, ist fÃ¼r die Anfertigung der GewÃ¤nder zustÃ¤ndig. Sie trÃ¤gt praktische Kleidung, die mit Nadelkissen und MaÃŸbÃ¤ndern ausgestattet ist. <em>Gregor</em>, ein Ã¤lterer Herr mit grauem Bart, berÃ¤t die Kunden mit seiner ruhigen und kompetenten Art.</p>
<hr>
<h3 data-heading="2. **â€žSchritt &amp; Trittâ€œ â€“ MaÃŸgeschneidertes Schuhwerk**">2. <strong>â€žSchritt &amp; Trittâ€œ â€“ MaÃŸgeschneidertes Schuhwerk</strong></h3>
<p>In der NÃ¤he des Marktplatzes liegt â€žSchritt &amp; Trittâ€œ, ein Schuhmacherbetrieb, der fÃ¼r seine maÃŸgeschneiderten Schuhe bekannt ist. Die AuÃŸenfassade ist schlicht, doch ein kunstvoll geschnitztes Holzschild mit einem stilisierten Schuh weist auf die QualitÃ¤t des Handwerks hin.</p>
<p>Im Inneren des Ladens riecht es nach Leder und Politur. Regale aus dunklem Holz prÃ¤sentieren eine Auswahl an Schuhen, von robusten Stiefeln bis zu eleganten Pantoffeln. Ein groÃŸer Arbeitstisch mit Werkzeugen und LederstÃ¼cken zeugt von der handwerklichen TÃ¤tigkeit.</p>
<p><strong>Besitzer:</strong> <em>Meister Alrik EisenfuÃŸ</em> ist ein krÃ¤ftiger Mann mit wettergegerbter Haut und einem dichten, braunen Bart. Er trÃ¤gt eine LederschÃ¼rze Ã¼ber seiner einfachen Kleidung und spricht mit einer tiefen, beruhigenden Stimme. Seine HÃ¤nde sind rau, doch geschickt, und seine Augen strahlen Stolz auf sein Handwerk aus.</p>
<p><strong>Angestellte:</strong> <em>Tilda</em>, eine junge Frau mit kurzem, lockigem Haar, ist fÃ¼r die Anprobe und Anpassung der Schuhe zustÃ¤ndig. Sie trÃ¤gt praktische Kleidung und ist stets freundlich und hilfsbereit. <em>Jorin</em>, ein stiller Geselle, arbeitet konzentriert an der Fertigung neuer Modelle.</p>
<hr>
<h3 data-heading="3. **â€žDie Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den Adel**">3. <strong>â€žDie Klingenschmiedeâ€œ â€“ Waffen fÃ¼r den Adel</strong></h3>
<p>In einer belebten StraÃŸe nahe der Stadtmauer befindet sich â€žDie Klingenschmiedeâ€œ, ein WaffengeschÃ¤ft, das sich auf die Herstellung von hochwertigen Klingen spezialisiert hat. Die Fassade ist mit Metallverzierungen geschmÃ¼ckt, und ein groÃŸes Schild mit einem stilisierten Schwert weist auf das Angebot hin.</p>
<p>Beim Betreten des Ladens hÃ¶rt man das rhythmische HÃ¤mmern aus der Schmiede im Hinterhof. Vitrinen prÃ¤sentieren kunstvoll gearbeitete Schwerter, Dolche und Rapiere, deren Klingen im Licht glÃ¤nzen. RÃ¼stungen und Schilde hÃ¤ngen an den WÃ¤nden, und ein Geruch nach Metall und SchmierÃ¶l liegt in der Luft.</p>
<p><strong>Besitzer:</strong> <em>Meisterin Brynja Stahlherz</em> ist eine hochgewachsene Frau mit muskulÃ¶sem KÃ¶rperbau und kurzem, rotem Haar. Sie trÃ¤gt eine schlichte Lederkleidung, die ihre Bewegungsfreiheit nicht einschrÃ¤nkt. Ihre Stimme ist krÃ¤ftig, und sie spricht mit einem nordischen Akzent.</p>
<p><strong>Angestellte:</strong> <em>Falk</em>, ein junger Schmiedegeselle mit ruÃŸverschmiertem Gesicht, arbeitet unter Brynjas Anleitung an neuen Klingen. <em>Mira</em>, eine erfahrene Waffenschmiedin, ist fÃ¼r die Gravuren und Verzierungen zustÃ¤ndig und trÃ¤gt stets eine Schutzbrille und Handschuhe.</p>
<hr>
<h3 data-heading="4. **â€žDer Edle Schnittâ€œ â€“ Barbier fÃ¼r gehobene AnsprÃ¼che**">4. <strong>â€žDer Edle Schnittâ€œ â€“ Barbier fÃ¼r gehobene AnsprÃ¼che</strong></h3>
<p>Im Herzen der Altstadt von Gareth, zwischen Marmorstatuen und kleinen Springbrunnen, steht ein Haus mit einem rot-weiÃŸ gestreiften Schild Ã¼ber dem Eingang. Der Laden trÃ¤gt den klangvollen Namen â€žDer Edle Schnittâ€œ und gilt unter Kennern als der Ort, an dem Haar, Bart und Haut mit hÃ¶chster Sorgfalt gepflegt werden.</p>
<p>Der Eingangsbereich gleicht mehr einem Salon als einem Handwerksbetrieb: vergoldete Spiegel an den WÃ¤nden, weiche StÃ¼hle aus Mahagoni mit tiefgrÃ¼ner Polsterung und kleine Kristallleuchter, die ein warmes, sanftes Licht spenden. Der Innenraum ist erfÃ¼llt vom Duft edler Pomaden, ZedernÃ¶l und feinen Rasierseifen. Instrumente aus Silber und Messing glÃ¤nzen ordentlich aufgereiht auf dunklen Ablagen.</p>
<p><strong>Besitzer:</strong> <em>Barbier Amando Calvero</em> ist der unangefochtene Herr Ã¼ber Schere und Klinge. Von mittlerer GrÃ¶ÃŸe, mit olivfarbener Haut, fein geschwungenem Bart und dunklen, klugen Augen, bewegt er sich mit einer Eleganz, als tanze er durch seinen Laden. Sein Haar ist zu einem perfekten Knoten hochgebunden, ein Seidenband in Purpur hÃ¤lt es in Form. Er trÃ¤gt eine taillierte schwarze Weste mit goldener Stickerei, ein weiÃŸes Hemd mit RÃ¼schenmanschetten und ein langes, schimmerndes Halstuch in Mitternachtsblau.</p>
<p><strong>Angestellte:</strong> <em>Serafin</em>, ein schlaksiger, junger Mann mit blassem Teint und hellblonden Locken, ist fÃ¼r Ordnung, Duftmischungen und Haarpflegeprodukte zustÃ¤ndig. Er trÃ¤gt ein blassviolettes Arbeitsgewand mit seidigem Glanz und spricht stets hÃ¶flich, fast unterwÃ¼rfig. <em>Lysandra</em>, eine rothaarige, energische Gesellin, versteht sich auf Damenfrisuren und ParfÃ¼merie. Sie trÃ¤gt ein elegantes, aber praktisches Kleid mit SpitzenschÃ¼rze, stets parfÃ¼miert mit Lavendel.</p>
<h3 data-heading="**6. â€žJuwelen der MorgenrÃ¶teâ€œ â€“ Schmuck fÃ¼r die Hohe Gesellschaft**"><strong>6. â€žJuwelen der MorgenrÃ¶teâ€œ â€“ Schmuck fÃ¼r die Hohe Gesellschaft</strong></h3>
<p>Zwischen edlen StadthÃ¤usern und verwinkelten Pflastergassen erhebt sich ein prÃ¤chtiges GebÃ¤ude mit kunstvoll verzierten Fenstern und einem auf Hochglanz polierten Schild aus Messing, das in verschnÃ¶rkelten Lettern den Namen â€žJuwelen der MorgenrÃ¶teâ€œ trÃ¤gt. Schon von auÃŸen glÃ¤nzen Edelsteine in Schauvitrinen und locken jene an, die nach exquisiten Kostbarkeiten suchen.</p>
<p>Der Innenraum ist eine Oase aus Glanz und Luxus. Samtene VorhÃ¤nge in dunklem Rot rahmen die Fenster, der Boden ist mit weichen Teppichen aus tulamidischer Webkunst bedeckt. Auf feingeschliffenen Tischen aus Glas und Mahagoni liegen Samtkissen, auf denen filigran gearbeitete SchmuckstÃ¼cke prÃ¤sentiert werden. Ein zartes Glockenspiel erklingt beim Betreten des Ladens, und der Duft von Myrrhe und Sandelholz liegt in der Luft.</p>
<p><strong>Besitzerin:</strong> <em>Madame Cyraleine von Teshkal</em>, eine Dame in den FÃ¼nfzigern mit schneeweiÃŸem Haar, trÃ¤gt stets einen langen violetten Mantel Ã¼ber einer edlen Brokatrobe. Ihre Haut ist makellos, ihre Bewegungen anmutig und ihr Blick durchdringend. Um ihren Hals hÃ¤ngt ein feines Collier aus blauen Saphiren, das sie selbst entworfen hat. Ihre goldenen Ringe sind mit Edelsteinen in kunstvollen Fassungen verziert, jeder ein Meisterwerk.</p>
<p><strong>SchmuckstÃ¼cke:</strong><br>
Die Kollektion umfasst Diademe aus WeiÃŸgold, in denen Amethyste wie Sterne gefasst sind. Ohrringe mit funkelnden Smaragden, deren Fassungen in Form stilisierter EfeublÃ¤tter gearbeitet sind. Ringe, deren Steine aus den Minen von Angbar stammen, eingefasst in filigrane Gravuren, die Geschichten alter Heldensagen erzÃ¤hlen.<br>
Ein besonders begehrtes StÃ¼ck ist ein Armband aus sieben verschiedenen Edelsteinen, die jeweils einen der ZwÃ¶lfgÃ¶tter symbolisieren â€“ vom goldgelben Topas fÃ¼r Praios bis zum tiefschwarzen Onyx fÃ¼r Boron.<br>
Zarte Halsketten aus Mondstein, die bei Kerzenschein schimmern, sowie Haarnadeln aus Silber mit eingravierten Elfenmustern runden das Sortiment ab. Viele der StÃ¼cke kÃ¶nnen personalisiert oder mit magischen Runen versehen werden â€“ fÃ¼r jene Kunden, die sich auch mystische Schutzwirkungen wÃ¼nschen.</p>
<p><strong>Angestellte:</strong> <em>Arenio</em>, ein junger Goldschmied mit ruhigem Auftreten, trÃ¤gt eine schlichte graue Tunika und eine Lupenbrille auf der Stirn. Er arbeitet hinter einer Glasscheibe an einem fein beleuchteten Werktisch und fÃ¼hrt mit geschickten HÃ¤nden Gravuren aus. <em>Lisanne</em>, eine charmante HÃ¤ndlerin, mit kastanienbraunem Haar und bernsteinfarbenen Augen, ist fÃ¼r den Verkauf zustÃ¤ndig. Sie trÃ¤gt selbst stets ein paar StÃ¼cke aus dem Sortiment â€“ zur Demonstration â€“ und spricht mit viel Wissen Ã¼ber Herkunft, Symbolik und Verarbeitung der Juwelen.</p>
<hr>
<h3 data-heading="**7. â€žEssenz der SphÃ¤renâ€œ â€“ ParfÃ¼merie und Duftkunst**"><strong>7. â€žEssenz der SphÃ¤renâ€œ â€“ ParfÃ¼merie und Duftkunst</strong></h3>
<p>Ein zierliches GebÃ¤ude mit einer blauen Kachelverzierung an der AuÃŸenwand beherbergt die â€žEssenz der SphÃ¤renâ€œ, eine ParfÃ¼merie, wie sie kein zweites Mal in Gareth zu finden ist. Der Eingang ist flankiert von zwei bronzenen Statuen, die elegante Frauengestalten mit Duftflakons darstellen. Beim Betreten des GeschÃ¤fts wird man in ein Reich der Sinne entfÃ¼hrt.</p>
<p>Die Luft ist durchtrÃ¤nkt von floralen, wÃ¼rzigen und harzigen Aromen, die in wechselnden Nuancen durch den Raum gleiten. Feine GlasflÃ¤schchen, kunstvoll geblasen und mit goldenen oder silbernen VerschlÃ¼ssen versehen, stehen ordentlich auf Regalen aus Zedernholz. Ein leises PlÃ¤tschern aus einem kleinen Duftbrunnen begleitet das sanfte Klingen von KristallanhÃ¤ngern, die vom Fenster baumeln.</p>
<p><strong>Besitzer:</strong> <em>Herr Aurelian Duftwacht</em>, ein schlanker Mann mit schwarzem Haar und spitzen GesichtszÃ¼gen, ist ParfÃ¼meur mit Leib und Seele. Er trÃ¤gt stets einen langen, cremefarbenen Kittel mit goldenen KnÃ¶pfen und einen Duftstein an einer Kette um den Hals. Sein gepflegter Bart ist dezent mit Ã–len behandelt, und seine Stimme klingt wie das FlÃ¼stern von Seide. Man munkelt, er kÃ¶nne allein durch Geruch die Herkunft eines Menschen erkennen.</p>
<p><strong>ParfÃ¼ms:</strong><br>
Im Angebot finden sich sowohl klassische als auch exotische DÃ¼fte.<br>
â€žMorgenhauchâ€œ â€“ ein leichter Duft mit Noten von Taurose, Veilchenblatt und einem Hauch von Minze, perfekt fÃ¼r EmpfÃ¤nge bei Sonnenaufgang.<br>
â€žFeuerherzâ€œ â€“ eine krÃ¤ftige Essenz aus Bernstein, Zimt, dunklem Harz und einem Hauch Moschus, bevorzugt von KÃ¤mpferinnen und Adeligen mit PrÃ¤senz.<br>
â€žWÃ¼stenwindâ€œ â€“ mit Oud, Myrrhe, Safran und getrockneter Feige, erinnert an tulamidische NÃ¤chte unter Sternenzelten.<br>
â€žSphÃ¤renklangâ€œ â€“ ein magischer Duft, hergestellt mit einem Tropfen EinhorntrÃ¤ne und LavendelgeiÃŸblatt, der angeblich Klarheit im Traum bringt.<br>
Alle ParfÃ¼ms werden auf Wunsch auch als DuftÃ¶le oder Salben abgefÃ¼llt, manche sogar mit alchimistischer Wirkung â€“ etwa um NervositÃ¤t zu lindern, MÃ¼digkeit zu vertreiben oder Romantik zu entfachen.</p>
<p><strong>Angestellte:</strong> <em>Mirjam</em>, eine Ã¤ltere Dame mit feinem Geruchssinn, leitet die Duftproben und berÃ¤t individuell, welcher Duft zur PersÃ¶nlichkeit passt. Ihre Kleidung ist elegant, aber schlicht â€“ ein lavendelfarbener Umhang mit goldbesticktem Kragen. <em>Kelian</em>, ein junger Novize aus Punin, hilft bei der Herstellung und ist spezialisiert auf das Destillieren seltener Pflanzenessenzen. Sein Gewand ist von Flecken aromatischer Ã–le durchzogen, und seine HÃ¤nde duften selbst dann nach Jasmin, wenn er schlÃ¤ft.</p>
<h1 data-heading="Spielmodule">Spielmodule</h1>
<h2 data-heading="ðŸª™ **Juwelen der MorgenrÃ¶te (Schmuckladen, gehoben)**">ðŸª™ <strong>Juwelen der MorgenrÃ¶te (Schmuckladen, gehoben)</strong></h2>
<p><strong>Ort:</strong> Oberstadt von Gareth<br>
<strong>Kategorie:</strong> LuxusgeschÃ¤ft (Schmuck, Juwelen, besondere EinzelstÃ¼cke)</p>
<hr>
<h3 data-heading="**NSCs**"><strong>NSCs</strong></h3>
<p><strong>ðŸ§• Madame Cyraleine von Teshkal (Besitzerin):</strong></p>
<ul>
<li><em>Typ:</em> Adelige Goldschmiedin<br>
</li>
<li><em>Professionelle Eigenschaften:</em> Handwerk (Goldschmiedekunst) 15, Etikette 14, Menschenkenntnis 13<br>
</li>
<li><em>Auftreten:</em> Ruhig, kultiviert, kennt sich mit den modischen Vorlieben der Adligen aus. Hat beste Kontakte zum Hof.<br>
</li>
<li><em>Geheimnis:</em> War einst Hofjuwelierin einer tulamidischen Prinzessin.<br>
</li>
</ul>
<p><strong>ðŸ‘¨ Arenio (Schmied):</strong></p>
<ul>
<li><em>Typ:</em> Handwerkerlehrling mit Talent<br>
</li>
<li><em>Eigenschaften:</em> Handwerk (Feinmechanik, Gravur) 11, Fingerfertigkeit 13<br>
</li>
<li><em>Besonderheit:</em> Still, aber leidenschaftlich â€“ kÃ¶nnte in ein Abenteuer Ã¼ber magische Runenringe verwickelt sein.<br>
</li>
</ul>
<p><strong>ðŸ‘© Lisanne (Verkauf):</strong></p>
<ul>
<li><em>Typ:</em> Charismatische HÃ¤ndlerin<br>
</li>
<li><em>Eigenschaften:</em> Ãœberreden 14, Etikette 13, Gassenwissen 11<br>
</li>
<li><em>StÃ¤rke:</em> Kann Kundschaft gut einschÃ¤tzen und ist charmant-direkt.<br>
</li>
</ul>

`
