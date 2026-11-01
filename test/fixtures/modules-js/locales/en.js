import { plural } from '../format.js';

// English, the source.
export default {
  title: 'Mood journal',
  /* Counted things go through plural(). */
  entries: (n) => plural(n, { one: '# entry', other: '# entries' }),
  today: (band) => `Today: ${band}`,
  points: (n) => plural(n, { one: '# point', other: '# points' }),
  agree: (terms, privacy) => 'I agree to the ' + terms + ' and have read the ' + privacy + '.',
};
