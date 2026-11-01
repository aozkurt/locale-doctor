export interface Position {
  line: number;
  column: number;
}

/** Returns a function that turns a string offset into a 1-based line and column. */
export function lineCounter(text: string): (offset: number) => Position {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - starts[low]! + 1 };
  };
}
