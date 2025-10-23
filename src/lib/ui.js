// src/lib/ui.js
export const ui = {
  selected: null,
  set(v){ this.selected = v; },
  is(v){ return this.selected === v; }
};
