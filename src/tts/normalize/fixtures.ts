export type SpeechFixture = { input: string; expected: string };

/**
 * One case per behaviour the normaliser promises. Keeping them as data makes
 * the idempotence check run over exactly the same inputs as the output check.
 */
export const FIXTURES: SpeechFixture[] = [
  // Years and year ranges.
  { input: '1905', expected: 'nineteen oh five' },
  { input: '2005', expected: 'two thousand five' },
  { input: '1066', expected: 'ten sixty-six' },
  { input: 'In 1999 she left.', expected: 'In nineteen ninety-nine she left.' },
  { input: '1990-95', expected: 'nineteen ninety to ninety-five' },
  { input: '2024-25', expected: 'twenty twenty-four to twenty-five' },
  { input: '1990-1995', expected: 'nineteen ninety to nineteen ninety-five' },
  { input: '1990–95', expected: 'nineteen ninety to ninety-five' },

  // Ranges.
  { input: '3-5', expected: 'three to five' },
  { input: 'pp. 10-20', expected: 'pages ten to twenty' },
  { input: '1st-4th', expected: 'first to fourth' },

  // Telephone numbers.
  { input: 'Call 555-1234.', expected: 'Call five five five, one two three four.' },
  { input: '1-800-555-0199', expected: 'one eight hundred, five five five, zero one nine nine' },

  // A lettered name with a number is not a numeric range.
  { input: 'COVID-19 lasted from 2019-2023.', expected: 'COVID nineteen lasted from twenty nineteen to twenty twenty-three.' },

  // Fractions.
  { input: '1/2', expected: 'one half' },
  { input: '3/4', expected: 'three quarters' },
  { input: '2/3', expected: 'two thirds' },
  { input: '1/4', expected: 'one quarter' },
  { input: '5+1/2', expected: 'five and a half' },
  { input: '½', expected: 'half' },
  { input: '3½', expected: 'three and a half' },

  // Ratios and dimensions.
  { input: '3:1', expected: 'three to one' },
  { input: '2x4', expected: 'two by four' },

  // Money.
  { input: '€1.2bn', expected: 'one point two billion euros' },
  { input: '£1.2m', expected: 'one point two million pounds' },
  { input: '$5.99', expected: 'five dollars and ninety-nine cents' },

  // Units and percent.
  { input: '100°C', expected: 'one hundred degrees Celsius' },
  { input: '10 kg/m²', expected: 'ten kilograms per square meter' },
  { input: '5 km', expected: 'five kilometers' },
  { input: '50%', expected: 'fifty percent' },

  // Dates.
  { input: '2024-05-03', expected: 'May third, twenty twenty-four' },
  { input: '3/5/24', expected: 'March fifth, twenty twenty-four' },
  { input: '13/5/24', expected: 'May thirteenth, twenty twenty-four' },

  // Times.
  { input: '9:00', expected: "nine o'clock" },
  { input: '9:05', expected: 'nine oh five' },
  { input: '10:30', expected: 'ten thirty' },
  { input: 'Mon 9am', expected: 'Monday nine A M' },
  { input: '9pm', expected: 'nine P M' },

  // Weekday abbreviations with a period or word boundary.
  { input: 'on Mon.', expected: 'on Monday.' },
  { input: 'Tue, Wed and Thu', expected: 'Tuesday, Wednesday and Thursday' },
  { input: 'Mar 5', expected: 'Mar five' },

  // Quarters and fiscal periods.
  { input: 'Q3', expected: 'third quarter' },
  { input: 'FY2024', expected: 'fiscal year twenty twenty-four' },
  { input: '1H23', expected: 'first half of twenty twenty-three' },

  // Abbreviations.
  { input: 'e.g. this', expected: 'for example this' },
  { input: 'i.e. that', expected: 'that is that' },
  { input: 'A vs. B', expected: 'A versus B' },
  { input: 'approx. 5', expected: 'approximately five' },
  { input: 'tea w/ milk', expected: 'tea with milk' },
  { input: 'Dr. Smith', expected: 'Doctor Smith' },
  { input: 'St. Mary', expected: 'Saint Mary' },
  { input: 'Oxford St.', expected: 'Oxford Street' },
  { input: 'p. 12', expected: 'page twelve' },
  { input: 'Ch. 4', expected: 'chapter four' },
  { input: 'Fig. 3', expected: 'figure three' },
  { input: 'Eq. 4', expected: 'equation four' },
  { input: 'Sec. 3', expected: 'section three' },
  { input: 'No. 5', expected: 'number five' },

  // Sentence-start expansions capitalise the expanded word.
  { input: 'No. 5 was empty.', expected: 'Number five was empty.' },
  { input: 'Ch. 4 covers a lot.', expected: 'Chapter four covers a lot.' },
  { input: 'He left. No. 5 was empty.', expected: 'He left. Number five was empty.' },
  { input: 'First line\nNo. 5 was empty.', expected: 'First line\nNumber five was empty.' },
  { input: 'e.g. this is fine.', expected: 'For example this is fine.' },
  { input: 'p. 12 is missing.', expected: 'Page twelve is missing.' },

  // Roman numerals.
  { input: 'Chapter IV', expected: 'chapter four' },
  { input: 'Henry VIII', expected: 'Henry the eighth' },
  { input: 'World War II', expected: 'World War Two' },

  // Math and symbols.
  { input: 'x^2', expected: 'x squared' },
  { input: '3 + 4 = 7', expected: 'three plus four equals seven' },
  { input: '√2', expected: 'the square root of two' },
  { input: 'word¹²', expected: 'word' },
  { input: 'mc²', expected: 'm c squared' },

  // Versions and addresses.
  { input: 'v2.1.0', expected: 'version two point one point zero' },
  { input: '192.168.1.1', expected: 'one nine two dot one six eight dot one dot one' },

  // Plain numbers stay cardinals when no year context is present.
  { input: '2,000', expected: 'two thousand' },
  { input: '3.14', expected: 'three point one four' },
  { input: '1st', expected: 'first' },
];
