import { plural } from '../format.js';

export default {
  title: '기분 일기',
  entries: (n) => plural(n, { other: '#개 항목' }),
  today: (band) => `오늘: ${band}`,
  // %p is "percentage points", not a format specifier.
  points: (n) => `${n}%p`,
  agree: (terms, privacy) => `${terms}에 동의하며 ${privacy}을 읽었습니다.`,
};
