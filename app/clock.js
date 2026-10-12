// Klokka i appen. I simulatoren kan tiden flyttes framover (tidsmaskin) uten å røre ekte data.
export const clock = {
  offset: 0,
  now() {
    return Date.now() + this.offset;
  },
  set(offset) {
    this.offset = offset || 0;
  },
};
