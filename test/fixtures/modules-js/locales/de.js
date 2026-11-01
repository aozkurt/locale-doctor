const { plural } = require('../format.js');

module.exports = {
  title: 'Stimmungstagebuch',
  entries: (n) => plural(n, { one: '# Eintrag', other: '# Einträge' }),
  today: (band) => `Heute: ${bnd}`,
  points: (n) => plural(n, { one: '# Punkt', other: '# Punkte' }),
  agree: (terms, privacy) => 'Ich stimme den ' + terms + ' zu und habe die ' + privacy + ' gelesen.',
  title: 'Stimmungsjournal',
};
