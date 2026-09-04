// Carino Fiscal — phonetic dictation tables.
//
// The single largest source of friction at a counter is a misheard letter, not
// a missing field. This file is the answer to that, and it is content rather
// than code: five hand-curated tables, one per interface language, chosen for
// what a clerk in that language would actually recognise. Each table says which
// convention it follows, so a later edit knows what it is deviating from.
//
// The tables are per LANGUAGE, not per country. A Mexican and a Colombian
// counter both hear the Spanish alfabeto telefónico; a Brazilian counter does
// not, and gets the Portuguese set instead.
//
// Latin letters in Japanese and Russian are spelled with the international
// (NATO) words rendered in the local script, because that is what is actually
// used on the phone in both languages — not the 和文通話表, which spells kana
// and cannot spell an RFC.
//
// Two renderings come out of the same table. `spell` is what goes on the card:
// separators that group the line for an eye. `speak` is what goes to a voice:
// no glyph a speech engine would try to pronounce, and a comma between tokens
// because that is what makes it pause.

(function () {
    'use strict';

    // An identifier is not always typed bare. The validator canonicalises away
    // spaces, dots and hyphens before it checks anything (js/engines.js), so a
    // CPF arrives as 111.444.777-35 and a Canadian BN as "123456789 RT0001" —
    // and a tier-3 record is free-form. Every separator therefore has to be a
    // word, or the dictation line loses the grouping the person is reading out.
    const TABLES = {
        // NATO/ICAO spelling alphabet (ICAO Annex 10, Volume II).
        en: {
            letters: {
                A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo',
                F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett',
                K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar',
                P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
                U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee',
                Z: 'Zulu', 'Ñ': 'N-tilde', '&': 'ampersand',
            },
            digits: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'],
            symbols: { '-': 'dash', '.': 'dot', '/': 'slash', ',': 'comma', ' ': 'space' },
            join: ' · ',
            sayJoin: ', ',
            fmt: (ch, word) => word,
        },

        // Alfabeto telefónico español — Antonio, Barcelona, Carmen… the list
        // Spanish speakers actually use on the phone, not a list of cities.
        // Ñ matters here: it is a legal character in an RFC.
        es: {
            letters: {
                A: 'Antonio', B: 'Barcelona', C: 'Carmen', D: 'Dolores', E: 'Enrique',
                F: 'Francia', G: 'Granada', H: 'Historia', I: 'Inés', J: 'José',
                K: 'Kilo', L: 'Lorenzo', M: 'Madrid', N: 'Navarra', 'Ñ': 'Ñoño',
                O: 'Oviedo', P: 'París', Q: 'Querido', R: 'Ramón', S: 'Sábado',
                T: 'Toledo', U: 'Ulises', V: 'Valencia', W: 'Washington',
                X: 'Xilófono', Y: 'Yegua', Z: 'Zaragoza', '&': 'y comercial',
            },
            digits: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'],
            symbols: { '-': 'guion', '.': 'punto', '/': 'barra', ',': 'coma', ' ': 'espacio' },
            // "y comercial" names the glyph rather than starting with it, so it
            // is spoken bare — "& de y comercial" is not Spanish anyone says.
            literal: ['&'],
            join: ' · ',
            sayJoin: ', ',
            fmt: (ch, word) => `${ch} de ${word}`,
        },

        // Brazilian set — everyday words rather than cities, which is the
        // convention there. K is deliberately not "Kilo": quilo is how the same
        // word is spelled in Portuguese and it already belongs to Q, so the two
        // letters would come out of the mouth identically.
        'pt-BR': {
            letters: {
                A: 'Amor', B: 'Bandeira', C: 'Casa', D: 'Dado', E: 'Elefante',
                F: 'Faca', G: 'Gato', H: 'Hotel', I: 'Índio', J: 'José',
                K: 'Kiwi', L: 'Lua', M: 'Maria', N: 'Navio', O: 'Ovo',
                P: 'Pato', Q: 'Quilo', R: 'Rato', S: 'Sapo', T: 'Tatu',
                U: 'Uva', V: 'Vitória', W: 'Wilson', X: 'Xadrez', Y: 'Yolanda',
                Z: 'Zebra', 'Ñ': 'N com til', '&': 'e comercial',
            },
            digits: ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'],
            symbols: { '-': 'hífen', '.': 'ponto', '/': 'barra', ',': 'vírgula', ' ': 'espaço' },
            // Portuguese has no Ñ, so its entry names the glyph instead of
            // giving a word that starts with it; same for the ampersand. Both
            // are spoken bare, or they come out circular — "Ñ de N com til".
            literal: ['&', 'Ñ'],
            join: ' · ',
            sayJoin: ', ',
            fmt: (ch, word) => `${ch} de ${word}`,
        },

        // NATO words in katakana. The 和文通話表 spells kana and is useless for a
        // Latin-alphabet tax ID, so it is deliberately not used here.
        ja: {
            letters: {
                A: 'アルファ', B: 'ブラボー', C: 'チャーリー', D: 'デルタ', E: 'エコー',
                F: 'フォックストロット', G: 'ゴルフ', H: 'ホテル', I: 'インディア', J: 'ジュリエット',
                K: 'キロ', L: 'リマ', M: 'マイク', N: 'ノベンバー', O: 'オスカー',
                P: 'パパ', Q: 'ケベック', R: 'ロミオ', S: 'シエラ', T: 'タンゴ',
                U: 'ユニフォーム', V: 'ビクター', W: 'ウイスキー', X: 'エックスレイ', Y: 'ヤンキー',
                Z: 'ズールー', 'Ñ': 'エヌチルデ', '&': 'アンパサンド',
            },
            digits: ['ゼロ', 'イチ', 'ニー', 'サン', 'ヨン', 'ゴー', 'ロク', 'ナナ', 'ハチ', 'キュー'],
            symbols: { '-': 'ハイフン', '.': 'ドット', '/': 'スラッシュ', ',': 'カンマ', ' ': 'スペース' },
            // Neither glyph has a katakana word starting with it, so both
            // entries name the character instead. Spoken with the glyph in
            // front a voice announces it twice — "& アンパサンド" — and & is
            // legal in a Mexican RFC, so this is a line a clerk really hears.
            literal: ['&', 'Ñ'],
            join: '・',
            sayJoin: '、',
            fmt: (ch, word) => `${ch}／${word}`,
            // The fullwidth solidus groups the pair on screen, but a voice reads
            // it out as a slash in the middle of the number. A space does the
            // same job silently.
            say: (ch, word) => `${ch} ${word}`,
        },

        // NATO words in Cyrillic — the standard way a Latin string is read out
        // in Russian. The dash stays in the spoken form: between a term and its
        // gloss it is ordinary Russian punctuation, and reads as a pause.
        ru: {
            letters: {
                A: 'Альфа', B: 'Браво', C: 'Чарли', D: 'Дельта', E: 'Эко',
                F: 'Фокстрот', G: 'Гольф', H: 'Отель', I: 'Индия', J: 'Джульетта',
                K: 'Кило', L: 'Лима', M: 'Майк', N: 'Новембер', O: 'Оскар',
                P: 'Папа', Q: 'Квебек', R: 'Ромео', S: 'Сьерра', T: 'Танго',
                U: 'Униформ', V: 'Виктор', W: 'Виски', X: 'Иксрей', Y: 'Янки',
                Z: 'Зулу', 'Ñ': 'Эн с тильдой', '&': 'амперсанд',
            },
            digits: ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
            symbols: { '-': 'дефис', '.': 'точка', '/': 'дробь', ',': 'запятая', ' ': 'пробел' },
            // Same as Japanese: both words name the character rather than
            // starting with it, so "& — амперсанд" reads the glyph out twice.
            literal: ['&', 'Ñ'],
            join: ' · ',
            sayJoin: ', ',
            fmt: (ch, word) => `${ch} — ${word}`,
        },
    };

    // Digits are spoken as words too: "0" and "O" are the pair that actually
    // gets confused in an RFC, and spelling both removes the ambiguity in one
    // pass. A character no table can spell is emitted as itself — an odd token
    // is recoverable, a silently dropped one is a shorter number than the
    // person is holding. For the same reason every block of a table is optional
    // here: a sixth language landing without a symbols map reads its separators
    // as bare glyphs rather than throwing on the first dot of a CNPJ.
    function render(value, lang, speaking) {
        const table = TABLES[lang] || TABLES.en;
        const letters = table.letters || {};
        const digits = table.digits || [];
        const symbols = table.symbols || {};
        const literal = table.literal || [];
        const fmt = (speaking && table.say) || table.fmt || ((ch, word) => word);
        const parts = [];

        for (const raw of String(value || '').toUpperCase()) {
            // Whatever glyph produced it, whitespace is a gap in the number: a
            // tab, or the non-breaking space that rides in on a PDF paste,
            // groups the line exactly as an ordinary space does and must not
            // disappear on the way to the counter.
            const ch = raw.trim() ? raw : ' ';
            if (ch >= '0' && ch <= '9' && digits[Number(ch)]) {
                parts.push(digits[Number(ch)]);
            } else if (letters[ch]) {
                parts.push(literal.indexOf(ch) === -1 ? fmt(ch, letters[ch]) : letters[ch]);
            } else if (symbols[ch]) {
                parts.push(symbols[ch]);
            } else if (ch.trim()) {
                parts.push(ch);
            }
        }
        return parts.join(speaking ? table.sayJoin : table.join);
    }

    // On the card, under the value. The separators are glyphs chosen to group
    // the line for an eye; they are not words and are not meant to be read.
    function spell(value, lang) { return render(value, lang, false); }

    // Straight into a SpeechSynthesisUtterance, unmodified. Every token is
    // already a word and the separator is already the one that makes that
    // language's voice pause, so there is nothing left for a caller to strip.
    // Reaching for spell() and deleting its separators instead is what leaves
    // ・ and ／ in the Japanese utterance for the engine to read out.
    function speak(value, lang) { return render(value, lang, true); }

    window.FiscalPhonetic = { spell: spell, speak: speak, tables: TABLES };
})();
