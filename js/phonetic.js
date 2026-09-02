// Carino Fiscal — phonetic dictation tables.
//
// The single largest source of friction at a counter is a misheard letter, not
// a missing field. This file is the answer to that, and it is content rather
// than code: five hand-curated tables, one per interface language, chosen for
// what a clerk in that language would actually recognise.
//
// The tables are per LANGUAGE, not per country. A Mexican and a Colombian
// counter both hear the Spanish alfabeto de ciudades; a Brazilian counter does
// not, and gets the Portuguese set instead.
//
// Latin letters in Japanese and Russian are spelled with the international
// (NATO) words rendered in the local script, because that is what is actually
// used on the phone in both languages — not the 和文通話表, which spells kana
// and cannot spell an RFC.

(function () {
    'use strict';

    const TABLES = {
        // NATO/ICAO spelling alphabet.
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
            join: ' · ',
            fmt: (ch, word) => word,
        },

        // Alfabeto de ciudades — the list Spanish speakers actually use on the
        // phone. Ñ matters here: it is a legal character in an RFC.
        es: {
            letters: {
                A: 'Ávila', B: 'Barcelona', C: 'Coruña', D: 'Dinamarca', E: 'España',
                F: 'Francia', G: 'Granada', H: 'Historia', I: 'Italia', J: 'José',
                K: 'Kilo', L: 'Lugo', M: 'Madrid', N: 'Navarra', 'Ñ': 'Ñoño',
                O: 'Oviedo', P: 'París', Q: 'Querido', R: 'Ramón', S: 'Sábado',
                T: 'Toledo', U: 'Ulises', V: 'Valencia', W: 'Washington',
                X: 'Xilófono', Y: 'Yegua', Z: 'Zaragoza', '&': 'et',
            },
            digits: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'],
            join: ' · ',
            fmt: (ch, word) => `${ch} de ${word}`,
        },

        // Brazilian set — everyday words rather than cities, which is the
        // convention there.
        'pt-BR': {
            letters: {
                A: 'Amor', B: 'Bandeira', C: 'Casa', D: 'Dado', E: 'Elefante',
                F: 'Faca', G: 'Gato', H: 'Hotel', I: 'Índio', J: 'José',
                K: 'Kilo', L: 'Lua', M: 'Maria', N: 'Navio', O: 'Ovo',
                P: 'Pato', Q: 'Quilo', R: 'Rato', S: 'Sapo', T: 'Tatu',
                U: 'Uva', V: 'Vitória', W: 'Wilson', X: 'Xadrez', Y: 'Yolanda',
                Z: 'Zebra', 'Ñ': 'N com til', '&': 'e comercial',
            },
            digits: ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'],
            join: ' · ',
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
            join: '・',
            fmt: (ch, word) => `${ch}／${word}`,
        },

        // NATO words in Cyrillic — the standard way a Latin string is read out
        // in Russian.
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
            join: ' · ',
            fmt: (ch, word) => `${ch} — ${word}`,
        },
    };

    // Spell one value for reading aloud. Digits are spoken as words too: "0"
    // and "O" are the pair that actually gets confused in an RFC, and spelling
    // both removes the ambiguity in one pass.
    function spell(value, lang) {
        const table = TABLES[lang] || TABLES.en;
        const chars = String(value || '').toUpperCase().split('');
        const parts = [];

        for (const ch of chars) {
            if (ch >= '0' && ch <= '9') {
                parts.push(table.digits[Number(ch)]);
            } else if (table.letters[ch]) {
                parts.push(table.fmt(ch, table.letters[ch]));
            } else if (ch.trim()) {
                parts.push(ch);
            }
        }
        return parts.join(table.join);
    }

    window.FiscalPhonetic = { spell: spell, tables: TABLES };
})();
