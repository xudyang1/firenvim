import { EventEmitter } from "./EventEmitter";
import { defaultKeyPairs, GlobalSettings, MappableKey, MappableKeyPairs, MappableKeys, NvimMode, ShiftMods } from "./utils/configuration";
import { nonLiteralKeys, addModifier, translateKey } from "./utils/keys";
import { isChrome } from "./utils/utils";

export class KeyHandler extends EventEmitter<"input", (s: string) => void> {
    private currentMode : NvimMode;
    constructor(private elem: HTMLElement, settings: GlobalSettings) {
        super();
        const ignoreKeys = settings.ignoreKeys;
        let keyToShiftedKey: MappableKeyPairs = {};
        let shiftedKeyToKey: MappableKeyPairs = {};

        function buildShiftedKeyToKey(settings: GlobalSettings) {
            keyToShiftedKey = settings.keyboard_layouts.default;

            let visited: Partial<Record<MappableKey, boolean>> = {};

            MappableKeys.forEach((v) => {
                visited[v] = false;
            });

            for (const [k, v] of Object.entries(keyToShiftedKey)) {
                if (
                    visited[k as MappableKey] === undefined ||
                    visited[v] === undefined
                ) {
                    console.warn("Invalid " +
                        (visited[k as MappableKey] === undefined ? ("key '" + k) : ("shifted key '" + v)) +
                        "' used in global config: keyboard_layout.default. Overriding."
                    );
                } else if (visited[v]) {
                    console.warn("Shifted key '" +
                        v +
                        "' is already defined in global config: keyboard_layout.default. Overriding."
                    );
                } else if (visited[v] === false) {
                    visited[v] = true;
                    continue;
                }
                settings.keyboard_layouts.default = defaultKeyPairs;
                keyToShiftedKey = defaultKeyPairs;
            }
            for (const [k, v] of Object.entries(keyToShiftedKey)) {
                shiftedKeyToKey[v] = k as MappableKey;
            }
        }

        buildShiftedKeyToKey(settings);

        function hasUnshiftedKey(shifted_key: string) {
            return shiftedKeyToKey[shifted_key as MappableKey] !== undefined;
        }

        function getUnshiftedKey(shifted_key: string) {
            if (shiftedKeyToKey[shifted_key as MappableKey]) {
                return shiftedKeyToKey[shifted_key as MappableKey];
            }
            return shifted_key;
        }
        this.elem.addEventListener("keydown", (evt) => {
            const evtKey = evt.key;
            const ctrlKey = evt.ctrlKey;
            const altKey = evt.altKey;
            const shiftKey = evt.shiftKey;
            // This is a workaround for osx where pressing non-alphanumeric
            // characters like "@" requires pressing <A-a>, which results
            // in the browser sending an <A-@> event, which we want to
            // treat as a regular @.
            // So if we're seeing an alt on a non-alphanumeric character,
            // we just ignore it and let the input event handler do its
            // magic. This can only be tested on OSX, as generating an
            // <A-@> keydown event with selenium won't result in an input
            // event.
            // Since coverage reports are only retrieved on linux, we don't
            // instrument this condition.
            /* istanbul ignore next */
            if (altKey && settings.alt === "alphanum" && !/[a-zA-Z0-9]/.test(evtKey)) {
                return;
            }
            // Note: order of this array is important, we need to check OS before checking meta
            const specialKeys = [["Alt", "A"], ["Control", "C"], ["OS", "D"], ["Meta", "D"]];

            const hasModifier = shiftKey || altKey || ctrlKey || evt.metaKey;
            // The event has to be trusted and either have a modifier or a non-literal representation
            if (
                evt.isTrusted
                && (nonLiteralKeys[evtKey] !== undefined
                    || (specialKeys
                        .concat([["Shift", "S"]])
                        .every(([mod, _]: [string, string]) => evtKey !== mod)
                        && hasModifier))
            ) {
                let inputMods: typeof specialKeys;
                let inputKey: string;
                const shiftAlt = shiftKey && altKey && !ctrlKey;
                const shiftCtrl = shiftKey && !altKey && ctrlKey;
                const shiftAltCtrl = shiftKey && altKey && ctrlKey;
                if (
                    hasUnshiftedKey(evtKey)
                    && !(
                        (shiftAlt && settings[ShiftMods.shiftAlt])
                        || (shiftCtrl && settings[ShiftMods.shiftCtrl])
                        || (shiftAltCtrl && settings[ShiftMods.shiftAltCtrl])
                    )
                ) {
                    inputMods = specialKeys;
                    inputKey = evtKey;
                } else {
                    inputMods = specialKeys.concat([["Shift", "S"]]);
                    inputKey = getUnshiftedKey(evtKey);
                }
                const text = inputMods.reduce((key: string, [attr, mod]: [string, string]) => {
                    if ((evt as any).getModifierState(attr)) {
                        return addModifier(mod, key);
                    }
                    return key;
                }, translateKey(inputKey));

                let keys : string[] = [];
                if (ignoreKeys[this.currentMode] !== undefined) {
                    keys = ignoreKeys[this.currentMode].slice();
                }
                if (ignoreKeys.all !== undefined) {
                    keys.push.apply(keys, ignoreKeys.all);
                }
                if (!keys.includes(text)) {
                    this.emit("input", text);
                    evt.preventDefault();
                    evt.stopImmediatePropagation();
                }
            }
        })

        const acceptInput = ((evt: any) => {
            this.emit("input", evt.target.value);
            evt.preventDefault();
            evt.stopImmediatePropagation();
            evt.target.innerText = "";
            evt.target.value = "";
        }).bind(this);

        this.elem.addEventListener("input", (evt: any) => {
            if (evt.isTrusted && !evt.isComposing) {
                acceptInput(evt);
            }
        });

        // On Firefox, Pinyin input method for a single chinese character will
        // result in the following sequence of events:
        // - compositionstart
        // - input (character)
        // - compositionend
        // - input (result)
        // But on Chrome, we'll get this order:
        // - compositionstart
        // - input (character)
        // - input (result)
        // - compositionend
        // So Chrome's input event will still have its isComposing flag set to
        // true! This means that we need to add a chrome-specific event
        // listener on compositionend to do what happens on input events for
        // Firefox.
        // Don't instrument this branch as coverage is only generated on
        // Firefox.
        /* istanbul ignore next */
        if (isChrome()) {
            this.elem.addEventListener("compositionend", (e: CompositionEvent) => {
                acceptInput(e);
            });
        }
    }

    focus() {
        this.elem.focus();
    }

    moveTo(x: number, y: number) {
        this.elem.style.left = `${x}px`;
        this.elem.style.top = `${y}px`;
    }

    setMode(s: NvimMode) {
        this.currentMode = s;
    }
}
