# Obsidian MarkdownToFoundry Plugin
Adjusts and exports the natively as HTML rendered Markdown from Obsidian to Foundry VTT.
An  [Obsidian](https://obsidian.md) plugin to copy notes as HTML to the clipboard, export as file and/or upload as journal to Foundry VTT.

## Foreword

A long time ago now it seems I read the following line:

_"Stories grow from stories told"_

The same can be said about software. I am a long time pen and paper player and even before the online VTT hype coming with corona which
brought dozens of VTT software to the market I was allready playing online by skype (for 10 years) with my long time 20 year old group.
I discovered Foundry VTT and it hooked me at once with it's ability to expand it with plugins, one time payment and self hosting.
Lately they do not give so much concern to some basic functionality I deem essentialy in a VTT - which are journals. They changed
the editor to Prose Mirror and it is still not able to import HTML in the same way as the old editor did and does. 
I understand fully the economic drive to expand on new flashy graphical enterprises moving Foundry VTT more towards a computer game but the 
essentials of a virtual TABLE top are in my eyes still handouts and text. I then discovered Obsidian MD which is a great tool
for managing content and text for a GM, but getting content out of Obsidian and to Foundry was mildly spoken a pain. There are tons of
HTML exporters but none of them could satisfy me and all needed additional manual adjustments which I needed to do outside in a second step.
Then funny as it sounds I found out by coincidence and due to personal contact about a HTML exporter that essentially did what I needed.
Blotspot released a derived work (https://github.com/blotspot/obsidian-markdown2html) this is where the line changes to:

_"Software grows from software shared"_

It was not exactly what I needed but it was a great foundation! So we are back to another famous analogy:

_It was scary stuff, but radically advanced. I mean, it was great, it didn’t work the way I needed it, but... it gave us ideas, took us in new directions. 
I mean, things we would have never... All my work is based on it._

Thats when I searched for a way to import things into Foundry VTT to automate things and funny coincidence again I found a 2-3 month old newly released
REST API module for Foundry VTT. Best of all the code was MIT AND the necessary relay server can be self hosted! PERFECT!

So I decided to do it on my own. I had never really done something bigger than a macro in JavaScript or even touched Typescript. I learned tons about both
doing this project. After all there is nothing better than to learn hands on a project. Still I would call this first release only a pretty stable BETA and my
code surely is not elegant or exceptional - there is still much to do in that regards BUT it seems to work! I am also willing to allways listen :)

So if you like this and I hope and I am pretty sure you will like it as a GM, keep both authors of the building blocks of this plugin in mind:

Blotspot has a Kofi Link in her manifest.json (https://ko-fi.com/blotspot).   
ThreeHats has also a partreon find out more here (https://github.com/ThreeHats/foundryvtt-rest-api). 
Also maybe give me a tip - once I figure out how to set that up - I think my age shows here. Gratefull for any tip how to do it.

I also tried to keep HTML export and Foundry upload as separated as possible and I improved a lot on flexibility I think. But one goal would be to even better separate
the code to do this and keep it clean. So you can use this also as a HTML exporter tool!
Maybe I will also export a markdownToHTML version or merge that part of the code with blotspot.

I also want to thank the discord members on the Obsidian plugin-dev channel!   
@saberzero1   
@TyXaNuch   
@joethei   
@mnaoumov has been exceptionally kind and helpfull!! Thanks!!   


## What it does

1. Converts the Markdown content of a note to HTML (either selected text or entire document) using Obsidian's markdown renderer. It also gives the option to
   export to Foundry VTT.
2. Cleans up the HTML from the clutter obsidian (naturally) adds
   - Removes all atrributes from tags (a list of attributes to keep can be configured in the settings)
   - Removes all classes (a list of classes to keep can be configured in the settings)
   - Can convert internal images into base64 strings
   - Removes empty paragraphs and divs (left overs from comment blocks, for example)
   - allows for export profiles
   - allows for HTML tag replacement
   - allows for HTML modification with regex expressions
   - allows to save HTML export to files (windows only so far and not too well tested yet)
   - allows to add a footer and header section for the exported HTML (so you can add a body tag and "style.css" for the file export)
   - allows to add your own JavaScript code (macro) to manipulate and adjust the HTML
   - allows to upload as journal to Foundry VTT
   - also uploads pictures and fixes picture paths for Foundry VTT
   - allows to relinking exported journal entries according to the Obsidian links
   - (planned if possible: batch export and relinking of stale links if a page is deleted and reexported)
   - (planned: make it linux compatible)
   - (planned: make it macOS compatible? and look into how to make it usable on Android)

> [!NOTE]  
> At this time it is a stable very first release. It evolves rapidly but I had not yet time to check all of its functionality on Linux or even MacOS.
> A lot of functionality currently expects CORRECT inputs - READ the settings section!
> The code needs more testing, more defaulting, more error handling and catching and probably less expectation from me to be a perfect piece of software.

## Tested on

- Desktop (Windows)

## Installation

### From Github

1. Download the latest release from the [releases page](https://github.com/CePeU/MarkdownToFoundry/releases).
2. Unzip the downloaded file.
3. Copy the folder to your Obsidian plugins directory (usually located at `.obsidian/plugins`).
4. Enable the "MarkdownToFoundry" plugin from the Settings > Community Plugins menu in Obsidian.

### As beta plugin (using BRAT)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Community Plugins in Obsidian.
2. Open the command palette and run the command `BRAT: Add a beta plugin for testing`
3. Copy the project link (https://github.com/CePeU/MarkdownToFoundry) into the modal that opens up.
4. Make sure **Enable after installing the plugin** is checked
5. Click on **Add Plugin**

#### Updating

Beta plugins can be updated using the command palette by running the command `Check for updates to all beta plugins and UPDATE`. Optionally, beta plugins can be configured to auto-update when starting Obsidian. This feature can be enabled in the BRAT plugin settings tab.

## Usage

### Variant 1:
1. Use the MarkdownToFoundry Icon on the left side in the Obsidian panel. This will use the last active profile (in the settings or choosen by variant 2)

### Variant 2:
1. Open the context menu (right click) 
2. Select the profile to use for your export. A default profile and a Foundry VTT profile are supplied. You can make your own profiles.

### Variant 3:
1. Open the command palette (default is `Ctrl+P` or `Cmd+P`) and search for **"MarkdownToFoundry"**.
2. Select **Copy selection or document to clipboard** to save your current selection, or if nothing is selected, the full file to the clipboard.

# General information how the plugin works

The plugin cleans the exported HTML from all clutter that Obsidian uses in it's rendered HTML. So in effect you have to tell the plugin what you want
to KEEP.
Keep that in mind if you modify attributes or classes because you then need to exclude them explicitly from beeing removed!

Currently the plugin works in the following order:
1) Convert images - convert image paths in HTML or convert to base64. Base64 encoding will overwrite any picture path links with the base64 encoded picture.  
   For Foundry export you therefore need to disable Base64 encoding unless you want to copy and paste into Foundry VTT from the clippboard! (But Prose Mirror
   is partly bugged in that regard - see explanations later)
3) Resolve internal links - resolve links in HTML to full internal links
4) Replace HTML tags - replace one tag with the other tag (or even with nothing). It uses query selector syntax to do that. Make sure you use it correctly!
5) Remove empty container - removes empty p and div nodes/containers which hold no inner content
6) Remove Frontmatter - removes frontmatter header of the HTML
7) Remove attributes - removes classes and attributes and keep only those specified

Up to this point a HTML node view was manipulated! After these steps an HTML string/text is manipulated.

7) Replace strings in the HTML (text) document with regex rules. Make sure they are correct!
8) Use your own JavaScript code to manipulate the HTML. (see details below in settings description)
9) If needed add a header and footer part to the HTML. It is your responsibility what is added and how that fits into the HTML structure!

## Plugin settings documentation
>[!IMPORTANT]
>You need to install configure three things for full Foundry VTT functionality! 

 A)  You need to install this plugin in Obsidian. This will give you HTML export and the ability to potentially push the HTML to Foundry VTT
 B)  You need to install a relay server or make an account with an open relay server which will be the communication hub between the 
     MarkdownToFoundry Obsidian plugin and the REST Foundry module. Installing the relay server locally will allow you to use an unlimited amount
     of rest calls.
     [ThreeHats/foundryvtt-rest-api-relay](https://github.com/ThreeHats/foundryvtt-rest-api-relay) or use https://foundryvtt-rest-api-relay.fly.dev
 C)  You need to install the Foundry REST module.
     [ThreeHats/foundryvtt-rest-api: A Foundry VTT module that provides a general purpose REST API through a WebSocket relay](https://github.com/ThreeHats/foundryvtt-rest-api)
 
>[!IMPORTANT]
> For first steps and probably most reliable functionality you should be logged in as a user into your foundry instance.
> You might get an error if you go inactive and the timeout to the relay server triggers.
> In that case reload your foundry session and try again.
> There is also a functionality to let the plugin login headless into a selected foundry instance but it is much slower.

---

## Profile Management

### Active Profile
- **Description**: Select the active profile to be used for export.
- **Actions**:
  - Switch between profiles using a dropdown menu.
  - Save the selected profile as the active profile.
  
Shows the active profile which will be used. If you press the FoundryToMarkdown button in the sidebar this
is the profile which will be used.
Inlcudes a default profile. If you get confused you can reset to some tried and meaningfull standard settings
for HTML export.

### Existing Profiles
- **Description**: Manage existing profiles.
- **Actions**:
  - Add a new profile.
  - Remove an existing profile.

You can add new profiles or remove profiles here.

### Clone Profile
- **Description**: Create a new profile by cloning the settings of the current profile.
- **Actions**:
  - Enter a name for the new profile.
  - Clone the current profile.

If you want to slightly modify a profile without inputing everything you can clone a profile.
Input a new name and the currently active profile will be cloned.

---

## HTML Export Settings

### Clipboard Export
- **Description**: Export the HTML to the clipboard.
- **Default**: Enabled.
- **Toggle**: Enable or disable this feature.

You can define if a copy of the overworked HTML is pasted to the clipboard or not.

### File Export
- **Description**: Export the HTML to a file.
- **Default**: Disabled.
- **Actions**:
  - Enable or disable file export.
  - Specify the file path for export.

You can give a windows path to export your html to. Make sure the path is correct!   
(TODO: Test for Linux and and make file path operations OS safe)

### Dirty Export
- **Description**: Export HTML without removing classes or attributes.
- **Default**: Disabled.
- **Toggle**: Enable or disable this feature.

This setting is one of the interesting ones. It allows for a dirty export of your HTML.
No changes will be made and you will see exactly what Obsidian exports. This is very helpfull
to analyze the HTML and beeing able to create rules to clean the HTML to your own needs.

---

## Attributes and Classes

### Attributes to Keep
- **Description**: Add attribute names you want to keep when rendering Markdown to HTML.
- **Default**: `["id", "href", "src", "width", "height", "alt", "colspan", "rowspan"]`
- **Actions**:
  - Add new attributes.
  - Reset attributes to default.
  
You can specify which attributes will NOT be cleaned from the HTML (see step 6)

### Classes to Keep
- **Description**: Add class names you want to keep when rendering Markdown to HTML.
- **Default**: Empty list.
- **Actions**:
  - Add new classes.
  - Reset classes to an empty list.

You can specify which classes will NOT be cleaned from the HTML (see step 6)

### Reset classes to keep
- A button to reset which classes shall be keept

---

## Rule-Based Replacements

### HTML Tag Replacement
- **Description**: Set up rules to replace HTML tags during export.
- **Example**: Replace `<div>` with `<p>`.

You can specify which tags are replaced or changed and what rule to use. Also the order of the rules applied
is set. The plugin uses query selector syntax.   
(TODO: Add examples)

### Regex Replacement Rules
- **Description**: Add regex rules to modify the HTML during export.
- **Example**: Use regex to replace specific patterns in the HTML.

You can specify what regex rules are applied and in which order. 
(TODO: Add examples)

### Javascript Replacements
- **Description**: Add custom JavaScript functions to modify the HTML during export.
- **Example**: Use JavaScript to manipulate the HTML string.

You can write Javascript code to manipulate the HTML. The HTML is supplied as a variable named "html".
For Foundry export a function to generate a foundry compliant ID (api.createID) is also exposed. You need to end your
function with "return 'variable holding the html string' " to return the modified HTML.

#### Example:
const newHtml = html.replace(/class="secret"/g, function(match) {
  const newId = api.createID(); 
  return `class="secret" id="secret-${newId}"`;
});
return newHtml


---

## Detailed Export Rules

### Header and Footer for HTML
- **Description**: Add custom text or HTML to the header and footer of the exported HTML.
- **Actions**:
  - Add or edit header and footer content.

You can add any text you like as header and footer to the output html text. Make sure it makes sense!

### Wikilink Resolution
- **Description**: Resolve internal Obsidian wikilinks and export them with the Obsidian vault path.
- **Default**: Disabled.
- **Toggle**: Enable or disable this feature.

This resolves internal Obsidian wikilinks to full sized path links.
IMPORTANT: Only limited tests have been conducted with (full) links inside of Obsidian. Only Obsidian like (short) wikilinks have
been tested.

### Image Encoding
- **Description**: Encode images as Base64 in the exported HTML.
- **Default**: Enabled.
- **Toggle**: Enable or disable this feature.

Encodes embeded images to Base64. You can then copy and paste directly into other applications like for example Bookstack. 
Be aware that Prose Mirror in Foundry is in my personal opinion potentially bugged and developers seem to see that as a 
"feature". Reports about strange sanitizing of HTML tags have been flagged as not to be implemented. Prose Mirror still remains
behind in abilities beyond TinyMCE after all these years and in addition does wierd things to HTML. Also it does not seem
there is really any drive to develop a good HTML editor alternative as this issue/idea is open for 4 years now. 

See my report: [Prose Mirror still stripping HTML wrongly and sanitizing too much � Issue #13167 � foundryvtt/foundryvtt](https://github.com/foundryvtt/foundryvtt/issues/13167)

One has to concede that the developers might be right in that regard as there probably is no need as there do not seem to be enough community bug reports about
journal handling else there would be a bigger need to fix those issues or patreon votes would be different.

#### So here are some observations/bugs and tips:
- Use the TinyMCE editor if you want to copy and past directly from clippboard!
- Opening journals with Prose Mirror which work with TinyMCE might lead to sanitizing and breaking your journal
- Do not use "id" attributes in tags you want to do an inner anchor link to
- Do not place any base64 encoded pictures between span elements
- Be carefull with span elements as they seem to be arbitrarily sanitized
- Font tags are problematic/useless (but I can understand that up to a point)
- .... to be continued
  
### Remove Frontmatter
- **Description**: Remove frontmatter from the exported HTML.
- **Default**: Enabled.
- **Toggle**: Enable or disable this feature.

Removes the frontmatter from the html. I do not know who would like to use and have it in their HTML BUT
they can if they like!

---

## Foundry Export Settings

### Foundry Export
- **Description**: Export the HTML to Foundry VTT via a REST call.
- **Default**: Disabled.
- **Toggle**: Enable or disable this feature.

This will give the ability to export the html to Foundry VTT as a journal entry.
You need to install the foundry REST module from ThreeHats and set up a relay server or use
the one which ThreeHats supplies (currently free of charge but bandwith costs money!).

1) Foundry REST Module: [ThreeHats/foundryvtt-rest-api: A Foundry VTT module that provides a general purpose REST API through a WebSocket relay](https://github.com/ThreeHats/foundryvtt-rest-api)
2) Relay Server: [ThreeHats/foundryvtt-rest-api-relay](https://github.com/ThreeHats/foundryvtt-rest-api-relay) or use https://foundryvtt-rest-api-relay.fly.dev

### API Key
- **Description**: API key for Foundry VTT export.
- **Default**: Empty.
- **Input**: Enter the API key.

You need an API key for the relay server. The API key is like your password so the Foundry instance
authorizes agains the relay server and this plugin does so also. You can set and get the API key
from the Foundry VTT REST module!

### Relay Server
- **Description**: IP or URL of the relay server for Foundry VTT.
- **Default**: `https://foundryvtt-rest-api-relay.fly.dev`
- **Input**: Enter the relay server address.

This defines the relay server to use. ThreeHats is so generous to supply a public one. You can also set
up your own. Be aware that the relay server only handles requests with a payload of a maximum of 250 MB!!!
So please do not try to upload journals with pictures/maps bigger than 250 MB! Also use compression on your pictures!
Be reminded again bandwith costs money.

### Foundry Session ID
- **Description**: Specify the Foundry world ID for export.
- **Default**: First active world is used if no ID is specified. This can lead to random results.
- **Input**: Enter the Foundry session ID.

Each Foundry session has a unique ID which is derived from the server, the world and the user loged in.
You can get this informmation from the Foundry module or with the helper button of the plugin.

### Helper to get Foundry Session ID
 **Description**: This button press will do a call agains the relay server and list all connected instances.
- **Default**: First active world is used if no ID is specified. This can lead to random results.
- **Input**: Choose one session ID from the dropdown

This button is to help you determine which session ID's are available. If you have only one Foundry instance
running you will only see one session ID. Also your Foundry installed Foundry module needs to be ACTIVE!
After some time even an active Foundry instance will drop the connection to the relay server! This is intended!
This means the best and safest way to get your session ID is to log in to your Foundry instance(s) and then press
this button to get your session ID(s). You then can select the desired one with the dropdown.

### Install Foundry VTT Journal Linking Macro
- **Description**: Install the linking macro to your Foundry session.
- **Actions**:
  - Install the macro.
  - (planned: also copy the macro to the clipboard.)

You need to have an active session to install the macro. Ideally you are logged in! 
By pressing this button a connection is established to your active foundry session and a relinking macro is installed. 
The macro will allow you to relink imported Obsidian journals. Any journals/pages not found will stay visible as "normal" hyperlink in the journal.
Just import your next journal/page and use the macro to link both journals/pages.

(Example how this works and what advantages an Obsidian UUID has)

---

## Foundry Headless Login Settings

### Foundry Headless Login
- **Description**: Allows connecting and exporting notes without being logged into Foundry.
- **Default**: Disabled.
- **Toggle**: Enable or disable this feature.

If all goes well (needs deeper testing) this will allow Obsidian to connect to your specified
Foundry session without you beeing logged in. This is slower because of the login process and
probably will only make sense much later IF a batch export can be done.

### Foundry Server IP
- **Description**: Set the IP/URL and port of the Foundry server.
- **Input**: Enter the server IP/URL.

### Foundry User
- **Description**: Set the username for login.
- **Input**: Enter the username.

### Foundry User Password
- **Description**: Set the password for the user.
- **Input**: Enter the password.

### Foundry World
- **Description**: Set the world name to log into.
- **Input**: Enter the world name.

>[!IMPORTANT]
>The world name needs to be the unique name you gave the world during creation.
>You can use the "worldTitle" which the helper button will show or the "customName"
>which you applied in your Foundry module.

---

## Foundry Standard Export Settings

Here you can set default settings where notes and pictures will be exported to. If you choose frontmatter usage
the exported page ID and all other settings will be written back into the frontmatter of your note!
You can then change the frontmatter in the note (or do that right away from the start). Frontmatter information
will overwrite standard settings. If no settings are found the plugin will default to a standard journal called
"ObsdianExport" in the root folder.

>[!IMPORTANT]
>Do NOT use file path slashes at the beginning or end of your paths in this settings!    
> DO: assets/pictures    
> DO NOT DO!!: /assets/pictures or assets/pictures/   

### Journal Linking After Every Export
- **Description**: Automatically run a journal linking process after each export.
- **Default**: Disabled.
- **Toggle**: Enable or disable this feature.

Instead of using a macro you can let the plugin execute code on your Foundry instance to relink journals
after each import.

### Set Foundry standard export settings
- **Description**: Allows to set standard export settings for Foundry export
- Default: Disabled
- 
### Foundry Folder
- **Description**: Set the default Foundry VTT export folder.
- **Input**: Enter the folder name.

### Foundry Journal
- **Description**: Set the default Foundry VTT export journal.
- **Input**: Enter the journal name.

### Foundry Picture Path
- **Description**: Set the default Foundry VTT picture export path.
- **Input**: Enter the picture path.

### Obsidian Frontmatter Usage and Foundry Writeback
- **Description**: Use frontmatter for export settings and write back Foundry information into Obsidian pages.
- **Default**: Disabled.
- **Toggle**: Enable or disable this feature.

This will write information about your exported note to the Obsidian note frontmatter. 
It also will give your obsidian note an UUID which can be used by the plugin to find the Obsidian note and the corresponding Foundry note. 

VTT_xxx frontmatter settings are foundry specific information.
The plugin will try to find the correct note for relinking but using an UUID should make updates, and relinking more stable.
Be aware that changing the frontmatter after your first import (like for example changing the folder) will reimport your
note as a NEW entry in Foundry and set a new VTT_UUID.
You will then have two Journals with the same obsidian UUID in Foundry. If a relinking takes place any not yet relinked note linking
to those two notes will be a randomly linked to the first (internally) found note with this obsidian UUID. So you need to do a delete
before a relink run.
(planned: way to relink such allready linked notes to the correct remaining note if only one remains after deleting the unwanted note)

---
## API Documentation

- Obsidian: https://github.com/obsidianmd/obsidian-api
