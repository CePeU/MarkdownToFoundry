import { App, Modal, Setting } from "obsidian";

export type RowData = [string, string];
export type RowArray = RowData[];

export class TwoColumnListModal extends Modal {
  private rows: RowArray;
  private onSubmit: (result: RowArray | null) => void;

  private rowsContainer: HTMLElement | null = null;

  constructor(app: App, initialRows: RowArray = [], onSubmit: (result: RowArray | null) => void) {
    super(app);
    this.rows = initialRows.length ? initialRows.map(r => [...r] as RowData) : [["", ""]];
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("m2f-modal");

  // Set fixed size on modal frame - solved with css
  //this.modalEl.style.width = '600px';
  //this.modalEl.style.height = '400px';
  //this.modalEl.style.maxWidth = '90vw';  // Responsive max
  //this.modalEl.style.maxHeight = '90vh';

    contentEl.addClass("m2f-modal-container");

    contentEl.createEl("h3", { text: "Zwei-Spalten-Liste bearbeiten" });
    
    // Container für alle Zeilen
    this.rowsContainer = contentEl.createDiv({
      cls: "m2f-modal-two-column-rows-container"
    });

    this.renderRows();

    // OK / Cancel Buttons
    const footer = contentEl.createDiv({ cls: "m2f-modal-footer" });

    new Setting(footer)
      .addButton(btn =>
        btn
          .setButtonText("OK")
          .setCta()
          .onClick(() => {
            // Leere Zeilen am Ende kannst du optional rausfiltern
            const cleaned = this.rows.filter(r => r[0] !== "" || r[1] !== "");
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

  // Gesamtes Redraw (Number-of-rows Ãndert sich)
  private renderRows() {
    if (!this.rowsContainer) return;
    this.rowsContainer.empty();

    this.rows.forEach((row, index) => {
      const rowEl = this.rowsContainer!.createDiv({
        cls: "m2f-modal-column-row",
        attr: {
          "data-index": index.toString(),
          draggable: "true" // für Drag & Drop (grab and move)
        }
      });

      // Drag-Handle
      const dragHandle = '\u22EE\u22EE';  // ⋮⋮
      const handle = rowEl.createSpan({ cls: "m2f-modal-row-drag-handle", text: `${dragHandle}` });

      // Spalte 1
      const col1 = rowEl.createEl("input", {
        type: "text",
        cls: "m2f-modal-column-input m2f-column1"
      });
      col1.value = row[0];

      // Spalte 2
      const col2 = rowEl.createEl("input", {
        type: "text",
        cls: "m2f-modal-column-input m2f-column2"
      });
      col2.value = row[1];

      // Up/Down/Delete Buttons
      //const up = '\u2191', down = '\u2193', trash = '\u{1F5D1}';
      const buttonBar = rowEl.createDiv({ cls: "m2f-modal-bar-buttons" });

	new Setting(buttonBar)
    .addButton(button =>
        button
          .setIcon("circle-arrow-up")
          //.setCta()
          .onClick(() => {
            this.moveRow(index,-1);       
          })
      )

    new Setting(buttonBar)
    .addButton(button =>
        button
          .setIcon("circle-arrow-down")
          //.setCta()
          .onClick(() => {
            this.moveRow(index,1);   
          })
      )

	new Setting(buttonBar)
    .addButton(button =>
        button
          .setIcon("trash-2")
          //.setCta()
          .onClick(() => {this.deleteRow(index)
        
          })
      )

    new Setting(buttonBar)
    .addButton(button =>
        button
          .setIcon("plus-circle")
          //.setCta()
          .onClick(() => {
            this.insertRowAfter(index)
          })
      )

      col1.addEventListener("input", (e: Event) => {
        this.rows[index][0] = (e.target as HTMLInputElement).value;
      });

      col2.addEventListener("input", (e: Event) => {
        this.rows[index][1] = (e.target as HTMLInputElement).value;
      });

      // Enter in der letzten Zeile erstellt neue Zeile
      const handleEnterInLast = (e: KeyboardEvent) => {
        if (
          e.key === "Enter" &&
          index === this.rows.length - 1
        ) {
          e.preventDefault();
          this.addRow();
          // optional: Fokus auf erste Spalte der neuen Zeile legen
          queueMicrotask(() => {
            const inputs = this.rowsContainer!.querySelectorAll<HTMLInputElement>("input.m2f-modal-column-input");
            const lastRowFirstInput = inputs[inputs.length - 2]; // jede Zeile hat 2 Inputs
            lastRowFirstInput?.focus();
          });
        }
      };
      col1.addEventListener("keydown", handleEnterInLast);
      col2.addEventListener("keydown", handleEnterInLast);

      this.attachRowDragHandlers(rowEl, handle);
    });

    // Optional: Globaler "Neue Zeile" Button unter allen Zeilen
    const addGlobalRowBtn = this.rowsContainer.createEl("button", {
      text: "Zeile hinzufügen",
      cls: "m2f-modal-add-row-global"
    });
    addGlobalRowBtn.addEventListener("click", () => this.addRow());
  }

  private addRow() {
    this.rows.push(["", ""]);
    this.renderRows();
  }

  private deleteRow(index: number) {
    if (this.rows.length === 1) {
      // Mindestens eine Zeile behalten (optional)
      this.rows[0] = ["", ""];
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

  private insertRowAfter(index: number){
    const insertIndex = index+1;
    this.rows.splice(insertIndex,0,["",""]);
    this.renderRows();
  }

  // 5) Grab & move mit Maus (Drag & Drop Reihenfolge)
  private attachRowDragHandlers(rowEl: HTMLElement, handle: HTMLElement) {
    let dragStartIndex: number | null = null;

    // Nur der Handle startet den Drag
    handle.addEventListener("mousedown", () => {
      rowEl.draggable = true;
    });
    handle.addEventListener("mouseup", () => {
      // nach dem Drag wieder deaktivieren, um Selektionsprobleme zu vermeiden
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
}
