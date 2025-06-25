function concat(a, b) {
  if (b === undefined) return a;
  return a + b;
}

export function getFilters() {
  return {
    concat,
  };
}
