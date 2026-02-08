import { App, Modal, Setting } from "obsidian";
import { MarkdownToFoundrySettings } from "./settings";

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

export type RowData = string[];
export type RowArray = RowData[];

export class MultiColumnListModal extends Modal {
  private rows: RowArray;
  private columnCount: number;
  private columnHeaders: string[];
  private onSubmit: (result: RowArray | null) => void;
  private rowsContainer: HTMLElement | null = null;
  private heading: string;
  private headingText: string;

  constructor(
    app: App,
    heading: string[] =["",""],
    initialRows: RowArray = [],
    onSubmit: (result: RowArray | null) => void,
    columnHeaders: string[] = []
  ) {
    super(app);
    this.heading  = heading[0];
    this.headingText = heading[1];
    // Determine column count from first row or headers
    this.columnCount = columnHeaders.length || (initialRows[0]?.length ?? 2);
    
    this.columnHeaders = columnHeaders.length === this.columnCount
      ? columnHeaders
      : Array(this.columnCount).fill(null).map((_, i) => `Column ${i + 1}`);
    
    // Normalize all rows to have consistent column count
    this.rows = initialRows.length
      ? initialRows.map(r => [...r.slice(0, this.columnCount), ...Array(Math.max(0, this.columnCount - r.length)).fill("")])
      : [Array(this.columnCount).fill("")];
    
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("m2f-modal");

    //======= define css layout =================
    const inputBoxSize = 25; //Size of input box fields

    // A grid definition is created according to the number of columns
    const grid = [
  '12px',                        // drag handle
  ...Array(this.columnCount).fill(`${inputBoxSize}rem`),
  'auto'                         // buttons
].join(' ');

//The css variable  --m2f-grid-columns is set with the corresponding grid layout
this.containerEl.style.setProperty(
  '--m2f-grid-columns',
  grid
);


  // Set fixed size on modal frame - solved with css
  //this.modalEl.style.width = '600px';
  //this.modalEl.style.height = '400px';
  //this.modalEl.style.maxWidth = '90vw';  // Responsive max
  //this.modalEl.style.maxHeight = '90vh';

    contentEl.addClass("m2f-modal-container");

    contentEl.createEl("h3", { text: this.heading });
    contentEl.createDiv({
      cls: "m2f-modal-explanation",
      text: this.headingText

  });

    //contentEl.createEl("hr");

    // Container für alle Zeilen
    this.rowsContainer = contentEl.createDiv({
      cls: "m2f-modal-two-column-rows-container"
    });

    this.renderRows();
  

    // OK / Cancel Buttons
    const footer = contentEl.createDiv({ cls: "m2f-modal-footer" });
    footer.style.setProperty("padding-top","20px")

    new Setting(footer)
      .addButton(btn =>
        btn
          .setButtonText("OK")
          .setCta()
          .onClick(() => {
            const cleaned = this.rows.filter(r => r.some(cell => cell !== ""));
            this.onSubmit(cleaned);
            this.close();
          })
      )
      .addButton(btn =>
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            this.onSubmit(null);
            this.close();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderRows() {
    if (!this.rowsContainer) return;
    this.rowsContainer.empty();

    
//==========================================    
  // Add header row with column names
  const headerRow = this.rowsContainer.createDiv({
    cls: "m2f-modal-column-row m2f-modal-header-row"
  });

  // Empty space for drag handle
  headerRow.createSpan({ cls: "m2f-modal-row-drag-handle" });

  //let headerCell = createSpan({ cls: "m2f-modal-column-names" })
  // Create header cells for each column
  for (let colIndex = 0; colIndex < this.columnCount; colIndex++) {
     const headerCell = headerRow.createSpan({
      cls: `m2f-modal-column-header m2f-column-${colIndex}`,
      text: this.columnHeaders[colIndex]
    });
  }

  //headerRow.appendChild(headerCell)
  // Empty space for button bar (to align with data rows)
  headerRow.createDiv({ cls: "m2f-modal-bar-buttons m2f-modal-bar-header" });
  //end column names
//============================================

    this.rows.forEach((row, index) => {
      const rowEl = this.rowsContainer!.createDiv({
        cls: "m2f-modal-column-row",
        attr: {
          "data-index": index.toString(),
          draggable: "true"
        }
      });

      // Drag-Handle
      const dragHandle = '\u22EE\u22EE';
      const handle = rowEl.createSpan({ cls: "m2f-modal-row-drag-handle", text: dragHandle });

      // Create input for each column
      for (let colIndex = 0; colIndex < this.columnCount; colIndex++) {
        const input = rowEl.createEl("input", {
          type: "text",
          cls: `m2f-modal-column-input m2f-column-${colIndex}`,
          attr: { "data-col": colIndex.toString() }
        });
        input.value = row[colIndex] || "";

        input.addEventListener("input", (e: Event) => {
          this.rows[index][colIndex] = (e.target as HTMLInputElement).value;
        });

        // Enter in last row creates new row
        const handleEnterInLast = (e: KeyboardEvent) => {
          if (e.key === "Enter" && index === this.rows.length - 1) {
            e.preventDefault();
            this.addRow();
            queueMicrotask(() => {
              const inputs = this.rowsContainer!.querySelectorAll<HTMLInputElement>("input.m2f-modal-column-input");
              const lastRowFirstInput = inputs[inputs.length - this.columnCount];
              lastRowFirstInput?.focus();
            });
          }
        };
        input.addEventListener("keydown", handleEnterInLast);
      }

      // Button Bar
      const buttonBar = rowEl.createDiv({ cls: "m2f-modal-bar-buttons" });

      new Setting(buttonBar).addButton(button =>
        button
          .setIcon("circle-arrow-up")
          .onClick(() => this.moveRow(index, -1))
      );

      new Setting(buttonBar).addButton(button =>
        button
          .setIcon("circle-arrow-down")
          .onClick(() => this.moveRow(index, 1))
      );

      new Setting(buttonBar).addButton(button =>
        button
          .setIcon("trash-2")
          .onClick(() => this.deleteRow(index))
      );

      new Setting(buttonBar).addButton(button =>
        button
          .setIcon("plus-circle")
          .onClick(() => this.insertRowAfter(index))
      );

      this.attachRowDragHandlers(rowEl, handle);
    });

/*
    // Add Row Button
    const addGlobalRowBtn = this.rowsContainer.createEl("button", {
      text: "Add Row",
      cls: "m2f-modal-add-row-global"
    });
    addGlobalRowBtn.addEventListener("click", () => this.addRow());
*/
    
    // Recalculate modal width after re-render
    queueMicrotask(() => this.sizeModalToGrid());
  }

  private addRow() {
    this.rows.push(Array(this.columnCount).fill(""));
    this.renderRows();
  }

  private deleteRow(index: number) {
    if (this.rows.length === 1) {
      this.rows[0] = Array(this.columnCount).fill("");
    } else {
      this.rows.splice(index, 1);
    }
    this.renderRows();

  }

  private moveRow(index: number, offset: number) {
    const newIndex = index + offset;
    if (newIndex < 0 || newIndex >= this.rows.length) return;
    const [item] = this.rows.splice(index, 1);
    this.rows.splice(newIndex, 0, item);
    this.renderRows();

  }

  private insertRowAfter(index: number) {
    const insertIndex = index + 1;
    this.rows.splice(insertIndex, 0, Array(this.columnCount).fill(""));
    this.renderRows();
   
  }

  private attachRowDragHandlers(rowEl: HTMLElement, handle: HTMLElement) {
    let dragStartIndex: number | null = null;

    handle.addEventListener("mousedown", () => {
      rowEl.draggable = true;
    });
    handle.addEventListener("mouseup", () => {
      rowEl.draggable = false;
    });

    rowEl.addEventListener("dragstart", (e: DragEvent) => {
      dragStartIndex = Number(rowEl.getAttr("data-index"));
      rowEl.addClass("dragging");
      e.dataTransfer?.setData("text/plain", dragStartIndex.toString());
      e.dataTransfer!.effectAllowed = "move";
    });

    rowEl.addEventListener("dragend", () => {
      rowEl.removeClass("dragging");
      dragStartIndex = null;
    });

    rowEl.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      rowEl.addClass("drag-over");
    });

    rowEl.addEventListener("dragleave", () => {
      rowEl.removeClass("drag-over");
    });

    rowEl.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      rowEl.removeClass("drag-over");
      const fromIndex = dragStartIndex ?? Number(e.dataTransfer?.getData("text/plain"));
      const toIndex = Number(rowEl.getAttr("data-index"));
      if (isNaN(fromIndex) || isNaN(toIndex) || fromIndex === toIndex) return;

      const [moved] = this.rows.splice(fromIndex, 1);
      this.rows.splice(toIndex, 0, moved);
      this.renderRows();
 
    });
  }

  /**
 * Sizes the modal width based on the rendered grid layout.
 *
 * Strategy:
 * 1. Let CSS calculate the grid (grid-template-columns)
 * 2. Measure the actual pixel width of one grid row
 * 3. Add modal padding + borders
 * 4. Clamp to 80% of the viewport
 */
private sizeModalToGrid() {
  if (!this.rowsContainer) return;

  // All rows share the same grid-template-columns,
  // so measuring the first one is sufficient
  const row = this.rowsContainer.querySelector<HTMLElement>(
    ".m2f-modal-column-row"
  );

  if (!row) return;

  // Width of the grid itself:
  // drag handle + inputs + buttons + gaps
  const rowWidth = row.getBoundingClientRect().width;

  // Modal padding and border are NOT included in row width
  const modalStyles = getComputedStyle(this.modalEl);

  const horizontalPadding =
    parseFloat(modalStyles.paddingLeft) +
    parseFloat(modalStyles.paddingRight);

  const horizontalBorder =
    parseFloat(modalStyles.borderLeftWidth) +
    parseFloat(modalStyles.borderRightWidth);

  const desiredWidth =
    rowWidth + horizontalPadding + horizontalBorder;

  // Never exceed 80% of the visible screen
  const maxWidth = window.innerWidth * 0.8;

  this.modalEl.style.width =
    Math.min(desiredWidth, maxWidth) + "px";
}

}
