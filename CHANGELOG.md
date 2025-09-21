# Changelog

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