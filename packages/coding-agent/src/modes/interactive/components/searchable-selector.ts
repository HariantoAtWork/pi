import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Spacer,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

export interface SearchableSelectorOptions {
	tui?: TUI;
	description?: string;
	onToggleToolsExpanded?: () => void;
}

export class SearchableSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	private listContainer: Container;
	private allOptions: string[];
	private filteredOptions: string[];
	private selectedIndex: number = 0;
	private onSelectCallback: (option: string) => void;
	private onCancelCallback: () => void;
	private titleText: Text;
	private onToggleToolsExpanded: (() => void) | undefined;

	constructor(
		title: string,
		options: string[],
		onSelect: (option: string) => void,
		onCancel: () => void,
		opts?: SearchableSelectorOptions,
	) {
		super();

		this.allOptions = options;
		this.filteredOptions = options;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.onToggleToolsExpanded = opts?.onToggleToolsExpanded;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.titleText = new Text(theme.fg("accent", theme.bold(title)), 1, 0);
		this.addChild(this.titleText);
		if (opts?.description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("text", opts.description), 1, 0));
		}
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		this.searchInput.onSubmit = () => {
			if (this.filteredOptions[this.selectedIndex]) {
				this.onSelectCallback(this.filteredOptions[this.selectedIndex]);
			}
		};
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add hint
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`  ${keyDisplayText("tui.select.up")}/${keyDisplayText("tui.select.down")} to navigate · ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("tui.select.cancel")} to cancel`,
				),
				0,
				0,
			),
		);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		// Initial render
		this.updateList();
	}

	private filterOptions(query: string): void {
		this.filteredOptions = query ? fuzzyFilter(this.allOptions, query, (opt) => opt) : this.allOptions;
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, this.filteredOptions.length - 1)));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredOptions.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredOptions.length);

		for (let i = startIndex; i < endIndex; i++) {
			const option = this.filteredOptions[i];
			if (!option) continue;

			const isSelected = i === this.selectedIndex;
			const text = isSelected
				? theme.fg("accent", "→ ") + theme.fg("accent", option)
				: `  ${theme.fg("text", option)}`;
			this.listContainer.addChild(new Text(text, 1, 0));
		}

		if (startIndex > 0 || endIndex < this.filteredOptions.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredOptions.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 1, 0));
		}

		if (this.filteredOptions.length === 0) {
			const message = this.allOptions.length === 0 ? "No options available" : "No matching options";
			this.listContainer.addChild(new Text(theme.fg("muted", `  ${message}`), 1, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "app.tools.expand")) {
			this.onToggleToolsExpanded?.();
		} else if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredOptions.length === 0) return;
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredOptions.length === 0) return;
			this.selectedIndex = Math.min(this.filteredOptions.length - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const selected = this.filteredOptions[this.selectedIndex];
			if (selected) this.onSelectCallback(selected);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		} else {
			this.searchInput.handleInput(keyData);
			this.filterOptions(this.searchInput.getValue());
		}
	}

	dispose(): void {}
}
