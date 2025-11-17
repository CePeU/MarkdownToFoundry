# Changelog

## [1.2.2] / 2025-11-17

### Fixed
- On first export the picture path was not initialiazed correctly for the picture collection (as no foundry object was initialiazed yet)


### Added
- HTML export was enhanced to allow for a wide range of export options to the file system
- absolute and relative paths for linked .md notes are possible now so one can use XAMPP or other digital garden solutions
- pictures and files can now be exported into the filesystem either into one path or keeping the vault path structure
- arbitrary file paths and tree structures should be possible (not extensivly enough tested yet) 

## [1.2.1] / 2025-10-30

### Fixed
- html file export paths without a trailing "/" should now work
- Readme was adjusted "Field2: section" instead of "Field2:secret"
- more checks if API Key is available and relay server field is filled before a foundry page export is conducted


### Added
- badges and GIF demo import animation was added to readme 

## [1.2.0] / 2025-10-30

### Fixed
- unlinked links are now handled propperly during parsing and no link reference is stored subsequently file is now exported to foundry
- Readme adjusted with new functionality and an update to the foundryID method usable for templater (templater example still missing)
- file safe handling of export for linux and windows (Macos als enabled but not tested)

### Added
- enhanced export functions for html to file system
- improve file export 
   - allows for setting a picture folder or write it into the same folder
   - keep the vault structure or declare a single folder where to save the files 
- make footer and header export more granular (linux and windows have been tentavitely tested, MacOS should work but could not be tested)
See: [Issue #6](https://github.com/CePeU/MarkdownToFoundry/issues/6)
- Obsidian UUID can now be created and written seperately
See: [Issue #3](https://github.com/CePeU/MarkdownToFoundry/issues/3)
- Foundry writeback can now be granularly set

## [1.1.1] / 2025-09-27

### Fixed
- Adjusted regex for secrets again. The regex needs to have a wider scope
See: [Issue 19](https://github.com/CePeU/MarkdownToFoundry/issues/19)
- TFile path cannot be found if a samba share is used. Adjusted the path so the base path for getting the pictures is correct even with samba shares. 
Now the path is cleaned till no backslash remains before it the path is normalized
See: [Issue #18](https://github.com/CePeU/MarkdownToFoundry/issues/18)
- Spelling in Readme.md and a wrong regex example have been corrected

## [1.1.0] / 2025-09-21

### Added
- Expose frontmatter to JavaScript Macro
Expose frontmatter informations to the Javascripting abilities. That way note informations can be given to the javascript.
**api.frontMatter()** will return the frontmatter of the currently cleaned note
See: [Issue #1](https://github.com/CePeU/MarkdownToFoundry/issues/1)

- Copy Macro code to clippboard if so choosen
Add the ability to copy the macro code to the clippboard. A new Button was introduced
See:[Issue #2](https://github.com/CePeU/MarkdownToFoundry/issues/2)

- Version information to be shown to the user
- Version information has been added to the profiles

- Make debug output optional
A new setting was implemented to select debug output
See: [Issue #13](https://github.com/CePeU/MarkdownToFoundry/issues/13)

### Fixed
- SVG Macro Icon is too dark/not visible on Foundry VTT 12.xxx
Reworked the SVG for the macro icon to be a bit smaller and have white stroke color
See:[Issue #16](https://github.com/CePeU/MarkdownToFoundry/issues/16)

### Changed
- Changed hirarchy of settings
All linking/relinking selections have been put under  **Foundry journal relinking export settings**
- The plugin is now able to check the version information and reimport profiles to new profile structures
- Readme was adjusted to include documentation for new macro settings
- **Changed picture collection function buildPictureUploadList to work on rendered HTML instead of embedds.**
This allows for Dataview and other plugins to render completly and including pictures and to export the rendered result.
This will also make it easier to export the rendered HTML to file paths and adjust the HTML for relative file paths in the filesystem.
- Changed regex which grabs the secret to add the secret id. This should now be a more stable regex.

## [1.0.2] / 2025-09-14
### Removed
- Removed test data which was still in the code for testing purposes to find a bug in the relay server

## [1.0.1] / 2025-09-14
### Added
- Included a Foundry VTT profile into the code to generate the data.json file if the plugin is fetched by the Obsidian/BRAT plugin manager.
See: [Issue #15](https://github.com/CePeU/MarkdownToFoundry/issues/15)

### Fixed
- Did a full pull from Github and some typings seem to have been missing. Package.json should be up to date now (hopefully)

## [1.0.0] / 2025-09-14
### Added
- First fairly stable release
### Fixed
### Changed
### Removed
### Deprecated
### Security