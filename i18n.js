// i18n — Carino Fiscal. Fleet convention: English source strings ARE the keys,
// so a missing entry falls back to English rather than to a blank.
//
// carino-lang.js (deferred, loaded before this file) owns the *preference* —
// ?lang= > the cookie on .carino.systems > browser language > English — and
// fires 'carino:langchange'. This file owns the *dictionary* and re-applies.
//
// What is NOT translated: everything under registry/. A régimen fiscal is
// named in Spanish because that is its legal name; translating "Régimen
// Simplificado de Confianza" would produce a string no Mexican counter has ever
// heard. Catalogue labels stay as the authority publishes them.
//
// The phonetic tables live in js/phonetic.js, not here — they are per language
// but they are content, not interface strings.
//
// Adding a string: put the English source in the markup or the TT() call, then
// add that exact string as a key to each of the four locale objects below, in
// the commented section it belongs to — the four objects carry the same
// sections in the same order, so the place a key goes in one is the place it
// goes in all of them. Order does not matter and nothing else has to move; the
// dictionaries are append-only by design. A value is normally the translated
// string; where a language inflects around a count it may be an object of
// Intl.PluralRules categories instead (see '{n} cards on this device'), and
// `other` must then read correctly for any number, because that is what a
// caller passing no count receives. Then run tools/check_i18n.py: it fails on a
// key missing from a locale, a key nothing references, a {placeholder} a
// translation dropped or invented, a counted string put into static markup
// where only the registry tallies can be substituted, a value still identical
// to the English, a key written twice, an element left inside a data-i18n
// sentence for applyStaticI18n to delete, and a lookup whose argument is not a
// literal.
//
// A string translated before the markup that shows it is not an error, but it
// has to say so: name it in RESERVED in tools/check_i18n.py with the call site
// it is waiting for, or the gate reports it as an orphan.

// Counts that belong to the registry rather than to prose. Every rendering of
// a string carrying {n}/{t1}/{t2} goes through fill(), so the number on screen
// is the one registry/index.json actually holds — the alternative is the same
// tally frozen into five translations, where promoting one jurisdiction makes
// four of them quietly wrong. js/app.js hands the loaded index to
// window.CarinoI18n.setCounts and the sentence re-renders; the values here only
// cover the paint before that fetch resolves, and tools/check_i18n.py fails the
// build the moment they stop describing registry/index.json.
const COUNTS = { n: 249, t1: 3, t2: 19 };

// A source string the markup has since reworded, mapped onto the key the
// dictionaries are keyed on, so a markup edit and a dictionary edit do not have
// to land together. Empty today: index.html now writes the coverage tallies as
// {n} / {t1} / {t2} itself, which is what retiring the two entries that were
// here looked like. English falls through to the canonical string, placeholders
// and all, so an aliased string only belongs where the counts are supplied.
const SOURCE_ALIASES = {};

// Every locale shipped today is left-to-right, but `dir` is what decides
// layout and nothing sets it. Stating it per locale now makes adding a
// right-to-left language a CSS review rather than an excavation.
const DIR = { en: 'ltr', es: 'ltr', 'pt-BR': 'ltr', ja: 'ltr', ru: 'ltr' };

const I18N = {
    // English is normally implicit — a missing entry falls back to the key — so
    // this object carries only what a key cannot say on its own. Today that is
    // the plurals: without them a caller passing n=1 reads "1 cards". An
    // ordinary English string does not belong here, because a copy change made
    // in the dictionary rather than in the markup is a change nobody can find
    // again. tools/check_i18n.py catches such an entry only while nothing
    // references it, as an orphan; an entry that shadows a key the markup or a
    // t() call still uses passes the gate and rewrites the English UI in
    // silence, so anything added here has to be argued for by hand.
    en: {
        '{n} cards on this device': { one: '{n} card on this device', other: '{n} cards on this device' },
        '{n} numbers this app never stores were found and left out.': { one: '{n} number this app never stores was found and left out.', other: '{n} numbers this app never stores were found and left out.' },
        '{n} cards restored': { one: '{n} card restored', other: '{n} cards restored' },
        '{n} were already here and were skipped': { one: '{n} was already here and was skipped', other: '{n} were already here and were skipped' },
        '{n} could not be read and were dropped': { one: '{n} could not be read and was dropped', other: '{n} could not be read and were dropped' },
    },

    es: {
        // Masthead
        'Skip to your cards': 'Ir a tus tarjetas',
        'Offline · nothing leaves this device': 'Sin conexión · nada sale de este dispositivo',
        "This card's address on this device": "Dirección de esta tarjeta en este dispositivo",
        "For any of {n} jurisdictions": "Para cualquiera de {n} jurisdicciones",
        "check it": "revísala",
        "Link": "Enlace",
        "The card itself, inside a link. Scanning it opens this card on any phone — the data rides after the “#”, so no server ever sees it.": "La tarjeta dentro de un enlace. Al escanearlo se abre en cualquier teléfono: los datos van después del «#», así que ningún servidor los ve.",
        "Your tax numbers for every country, ready to read out at the counter.": "Tus números fiscales de cada país, listos para dictarlos en el mostrador.",
        "Works offline. Nothing leaves this device.": "Funciona sin conexión. Nada sale de este dispositivo.",
        "See it with sample cards": "Verlo con tarjetas de ejemplo",
        "Sample cards. Every number is invented but passes its country's real check-digit rule. Nothing here is saved.": "Tarjetas de ejemplo. Todos los números son inventados pero cumplen el dígito verificador real de su país. Nada de esto se guarda.",
        "Leave samples": "Salir de los ejemplos",
        "A card from a shared link. It is only being shown — nothing has been saved to this device.": "Una tarjeta de un enlace compartido. Solo se está mostrando: no se ha guardado nada en este dispositivo.",
        "Keep this card": "Guardar esta tarjeta",
        "The official catalogue was updated on {date}, after you last confirmed this card.": "El catálogo oficial se actualizó el {date}, después de la última vez que confirmaste esta tarjeta.",
        "Never confirmed against your own documents.": "Nunca se ha confirmado contra tus propios documentos.",
        "Last confirmed on {date}. Worth checking it still matches your records.": "Confirmada por última vez el {date}. Conviene revisar que siga coincidiendo con tus registros.",
        "Confirmed {date}": "Confirmada el {date}",
        "E-invoicing mandatory": "Factura electrónica obligatoria",
        "E-invoicing scheduled": "Factura electrónica programada",
        "E-invoicing partly in force": "Factura electrónica parcialmente vigente",
        "No e-invoicing mandate": "Sin obligación de factura electrónica",
        "Fill it from a document": "Llénala desde un documento",
        "Drop in the PDF the tax authority issued, or paste the text of one.": "Sube el PDF que emitió la autoridad fiscal, o pega su texto.",
        "Paste any text holding your tax number — an email signature works.": "Pega cualquier texto con tu número fiscal: una firma de correo sirve.",
        "…or paste text here": "…o pega el texto aquí",
        "Reading…": "Leyendo…",
        "Read {n} fields from the document.": "Se leyeron {n} campos del documento.",
        "Nothing recognisable found. Fill the fields below instead.": "No se reconoció nada. Llena los campos de abajo.",
        "That file could not be read.": "No se pudo leer ese archivo.",
        "Share this card": "Compartir esta tarjeta",
        "vCard": "vCard",
        "Carino payload": "Formato Carino",
        "A vCard — any phone camera reads this and offers to save it as a contact.": "Una vCard: la cámara de cualquier teléfono la lee y ofrece guardarla como contacto.",
        "A Carino payload — only this app reads it, kept for exchanging a card between your own devices.": "Un formato Carino: solo esta app lo lee; sirve para pasar una tarjeta entre tus propios dispositivos.",
        "The QR encoder did not load.": "No se cargó el codificador QR.",
        "QR code for this card": "Código QR de esta tarjeta",
        "Save as image": "Guardar como imagen",
        "Save .vcf": "Guardar .vcf",
        "Copy vCard": "Copiar vCard",
        "Copy link": "Copiar enlace",
        "Send to Quote": "Enviar a Quote",
        "Opening Quote…": "Abriendo Quote…",
        "Sent to Quote": "Enviado a Quote",
        "Quote did not answer": "Quote no respondió",
        "The link carries the card after the “#”, which browsers never send to a server — so nothing is uploaded. It does sit in history and clipboards, so treat it as a share, not a secret.": "El enlace lleva la tarjeta después del «#», que los navegadores nunca envían al servidor: no se sube nada. Sí queda en el historial y el portapapeles, así que trátalo como algo compartido, no secreto.",
        "Speak it": "Léelo en voz alta",

        // Head — the tab title and the meta description, keyed on index.html
        'Carino Fiscal — your tax identity, offline, in any country': 'Carino Fiscal — tu identidad fiscal, sin conexión, en cualquier país',
        'An offline card that holds your fiscal identity — personal and business — for every jurisdiction you file in. Check digits validated on device, spelled out phonetically for the counter, and never sent anywhere.': 'Una tarjeta sin conexión con tu identidad fiscal — personal y de empresa — para cada país en el que declaras. Los dígitos verificadores se validan en el dispositivo, se deletrean para el mostrador, y nunca se envían a ningún lado.',

        // Navbar (carino-navbar.js reads these through window.t)
        'Late shift.': 'Turno nocturno.',
        'Good morning.': 'Buenos días.',
        'Good afternoon.': 'Buenas tardes.',
        'Good evening.': 'Buenas noches.',
        'Close': 'Cerrar',

        // Jurisdiction
        'Tier': 'Nivel',
        // The badge below reads 'Sin verificar' and speaks about the number;
        // the pill speaks about the record, so it must not say the same thing.
        'unverified': 'registro sin verificar',
        'Change': 'Cambiar',
        'Jurisdiction': 'Jurisdicción',
        'Checksum, invoice profile and delivery verified against the authority.': 'Dígito verificador, perfil de facturación y entrega verificados contra la autoridad.',
        'Structure verified; invoice profile is not guaranteed.': 'Estructura verificada; el perfil de facturación no está garantizado.',
        'Free-form record. Stored and presented, but nothing is validated.': 'Registro libre. Se guarda y se muestra, pero no se valida nada.',
        '{n} of {total} jurisdictions': '{n} de {total} jurisdicciones',
        // The picker list is cut to 120 rows, so this count is a disclosure
        // rather than decoration: it has to say the rest are still there.
        'type to narrow': 'escribe para filtrar',
        'your card': 'tu tarjeta',

        // Card kinds
        'Personal': 'Personal',
        'Business': 'Empresa',
        'personal': 'personal',
        'business': 'de empresa',
        'Card': 'Tarjeta',
        'No card yet': 'Aún sin tarjeta',
        'Kind': 'Tipo',

        // Validation badges
        'Check digit valid': 'Dígito verificador correcto',
        'Check digit does not match': 'El dígito verificador no coincide',
        'Wrong format': 'Formato incorrecto',
        'Format only — no published check digit': 'Solo formato — sin dígito verificador publicado',
        'Reserved official value': 'Valor oficial reservado',
        'Not checked': 'Sin verificar',
        'Empty': 'Vacío',
        'expected': 'se esperaba',

        // Statuses the engine can return beyond a check digit that matched or
        // did not. Each has to read as a different verdict from 'Not checked':
        // a number the authority never issued is not a number nobody looked at.
        'Never issued by the authority': 'La autoridad nunca lo emitió',
        'The arithmetic fits, but this is a filler value the authority never issues.': 'La aritmética cuadra, pero es un valor de relleno que la autoridad nunca emite.',
        'This app never stores this number': 'Esta app nunca guarda este número',
        'A number the state uses to identify a person is refused on every card. Use the number your counter actually asks for.': 'Un número con el que el Estado identifica a una persona se rechaza en cualquier tarjeta. Usa el número que de verdad te piden en el mostrador.',
        'Published rule this build does not run': 'Regla publicada que esta versión no ejecuta',
        'The authority publishes a check rule for this identifier and this build does not run it, so the number has not been checked.': 'La autoridad publica una regla de verificación para este identificador y esta versión no la ejecuta, así que el número no se ha comprobado.',
        'Worth reading back': 'Conviene volver a leerlo',
        'The check digit matched, but it cannot see the third character. Read that one back against your document.': 'El dígito verificador coincide, pero no alcanza al tercer carácter. Vuelve a revisar ese contra tu documento.',
        'The check digit matched, but it cannot tell a 0 from a 9. Read every 0 and 9 back against your document.': 'El dígito verificador coincide, pero no distingue un 0 de un 9. Vuelve a revisar cada 0 y cada 9 contra tu documento.',

        // Actions
        'Copy': 'Copiar',
        'Copied': 'Copiado',
        'Copy all': 'Copiar todo',
        'Counter mode': 'Modo mostrador',
        'Share': 'Compartir',
        'Print': 'Imprimir',
        'Edit': 'Editar',
        'Save': 'Guardar',
        'Cancel': 'Cancelar',
        'Delete': 'Eliminar',
        'Add card': 'Agregar tarjeta',
        'Show official QR': 'Ver QR oficial',
        'Official QR': 'QR oficial',
        'The official QR image saved on this card': 'La imagen del QR oficial guardada en esta tarjeta',
        'Copy a backup': 'Copiar respaldo',

        // Empty state
        'No {kind} card for {country} yet': 'Aún no hay tarjeta {kind} para {country}',
        'Add one and it stays on this device — nothing is ever sent anywhere.': 'Agrégala y se queda en este dispositivo: nunca se envía a ningún lado.',
        'Example — not your data': 'Ejemplo — no son tus datos',

        // Generic field labels — the fallback for a jurisdiction whose record
        // names no label of its own. Wording follows the registry's own Spanish.
        'Legal name': 'Nombre legal',
        'Name': 'Nombre',
        'Address': 'Dirección',
        'Email': 'Correo',
        'Tax ID': 'Número fiscal',

        // Editor
        'Edit card': 'Editar tarjeta',
        'New card': 'Nueva tarjeta',
        'Card name': 'Nombre de la tarjeta',
        'e.g. Carino Systems': 'ej. Carino Systems',
        'e.g. Personal': 'ej. Personal',
        'optional': 'opcional',
        'not stored': 'no se guarda',
        'Image stored': 'Imagen guardada',
        'That image is too large — keep it under 400 KB.': 'Esa imagen es muy grande: debe pesar menos de 400 KB.',
        'That file could not be read as an image.': 'No se pudo leer ese archivo como imagen.',
        'Get it from the authority': 'Obtenerlo en la autoridad',
        'Catalogue verified': 'Catálogo verificado',

        // Manage
        'Your cards': 'Tus tarjetas',
        // Counted strings carry Intl.PluralRules categories. 'other' doubles as
        // the form a caller that passes no count gets, so it has to be the
        // phrasing that is right for any number.
        '{n} cards on this device': { one: '{n} tarjeta en este dispositivo', other: '{n} tarjetas en este dispositivo' },
        'Nothing stored yet': 'Aún no hay nada guardado',

        // Privacy
        'No analytics, no sync, no account, no error reporting. The only things this page asks the network for are its own files from this domain, and not one request carries anything you typed.': 'Sin analítica, sin sincronización, sin cuenta, sin reportes de error. Lo único que esta página le pide a la red son sus propios archivos de este dominio, y ninguna petición lleva nada de lo que escribiste.',
        'Cards live in this browser, on this device only. Clearing site data deletes them, and no other device or browser can see them.': 'Las tarjetas viven en este navegador y solo en este dispositivo. Borrar los datos del sitio las elimina, y ningún otro dispositivo o navegador puede verlas.',
        'Some numbers are refused outright. A US Social Security Number and a Japanese My Number are never stored — the card editor explains why and what to use instead.': 'Algunos números se rechazan por completo. El Social Security Number de EE. UU. y el My Number japonés nunca se guardan: el editor explica por qué y qué usar en su lugar.',
        'Coverage:': 'Cobertura:',
        'every ISO 3166 jurisdiction is present —': 'están todos los países y territorios de la ISO 3166 —',
        'in all. {t1} are verified against their authority, {t2} carry published structure, and the rest store and present without validating. Each card says which.': 'en total. {t1} están verificados contra su autoridad, {t2} traen estructura publicada, y el resto se guardan y se muestran sin validar. Cada tarjeta lo indica.',

        // Errors
        'The registry failed to load. Serve this folder over http:// rather than opening the file directly, or check that the registry/ directory is intact.': 'No se pudo cargar el registro. Sirve esta carpeta por http:// en vez de abrir el archivo directamente, o revisa que el directorio registry/ esté completo.',
        'This browser is not letting the page store anything, so cards will disappear when you reload. A private window or blocked site data is the usual cause.': 'Este navegador no permite guardar nada, así que las tarjetas desaparecerán al recargar. Suele deberse a una ventana privada o a datos del sitio bloqueados.',
        'Nothing was written to this device, so this will be gone when you reload.': 'No se escribió nada en este dispositivo, así que esto desaparecerá al recargar.',
        'Search {n} jurisdictions': 'Buscar entre {n} jurisdicciones',

        // Import review. js/import.js hands back a review rather than values, and
        // every code it can carry is named here: `problem` is why a document
        // yielded nothing, `reason` is why one candidate is not ticked.
        'Check what was read': 'Revisa lo que se leyó',
        'Nothing is filled in until you confirm.': 'No se llena nada hasta que lo confirmes.',
        'Use the ticked fields': 'Usar los campos marcados',
        'That PDF is password-protected. Unlock it and save a copy, or paste its text below.': 'Ese PDF está protegido con contraseña. Ábrelo, guarda una copia sin protección, o pega su texto abajo.',
        'That PDF is damaged and could not be read.': 'Ese PDF está dañado y no se pudo leer.',
        'That file is empty.': 'Ese archivo está vacío.',
        'That file is not a PDF.': 'Ese archivo no es un PDF.',
        'That PDF holds no text — it is a scan or a photo. Type the fields in, or paste the text from somewhere else.': 'Ese PDF no tiene texto: es un escaneo o una foto. Escribe los campos a mano, o pega el texto desde otro lado.',
        'That file is not text and cannot be read here.': 'Ese archivo no es texto y no se puede leer aquí.',
        'Only part of that document could be read. Check every field before you save.': 'Solo se pudo leer parte de ese documento. Revisa cada campo antes de guardar.',
        'The PDF reader did not load, so PDFs cannot be opened here yet. Go online once to finish installing, or paste the text instead.': 'El lector de PDF no se cargó, así que todavía no se pueden abrir PDF aquí. Conéctate una vez para terminar la instalación, o pega el texto.',
        'Printed as somebody else’s number': 'Aparece como el número de otra persona',
        'Found without a label naming it': 'Se encontró sin una etiqueta que lo nombre',
        'Recognised only by its shape': 'Reconocido solo por su forma',
        'Completed by this app, not read from the document': 'Lo completó esta app; no se leyó del documento',
        'Two readings of this were possible': 'Había dos lecturas posibles',
        'Only one of these can be right': 'Solo uno de estos puede ser el correcto',
        'The same value was found twice': 'El mismo valor se encontró dos veces',
        'Another reading of this number fails its check digit — compare it with the paper.': 'Otra lectura de este número no pasa su dígito verificador: compáralo con el papel.',
        'The document prints check digit {printed}, but the rule computes {expected}. Nothing was filled in — check the paper and type it.': 'El documento imprime el dígito verificador {printed}, pero la regla calcula {expected}. No se llenó nada: revisa el papel y escríbelo a mano.',
        '{n} numbers this app never stores were found and left out.': { one: 'Se encontró {n} número que esta app nunca guarda y se omitió.', other: 'Se encontraron {n} números que esta app nunca guarda y se omitieron.' },
        'The card name held a number this app never stores, so the card was saved without a name.': 'El nombre de la tarjeta contenía un número que esta app nunca guarda, así que la tarjeta se guardó sin nombre.',
        'Not found in the document': 'No se encontró en el documento',
        'found beside “{label}”': 'encontrado junto a «{label}»',
        'found with no label': 'encontrado sin etiqueta',
        'This document names {name} as the holder.': 'Este documento indica que el titular es {name}.',

        // Share and hand-off. A link that will not open and a card that did not
        // reach Quote each have several causes, and js/share.js separates them:
        // collapsing them sends four people out of five after the wrong problem.
        'That link is damaged and could not be read.': 'Ese enlace está dañado y no se pudo leer.',
        'That link was made by a newer version of this app. Reload this page and open it again.': 'Ese enlace lo hizo una versión más nueva de esta app. Recarga la página y ábrelo otra vez.',
        'That link carries a number this app never stores, so it was not opened.': 'Ese enlace lleva un número que esta app nunca guarda, así que no se abrió.',
        'That link is far longer than anything this app writes, so it was not opened.': 'Ese enlace es mucho más largo que cualquiera que escriba esta app, así que no se abrió.',
        'That card is for {country}, not this one.': 'Esa tarjeta es de {country}, no de este país.',
        'Link not verified': 'Enlace sin verificar',
        'This link is from an older version and carries no integrity check. Read every number back against your own document before you use it.': 'Este enlace es de una versión anterior y no trae verificación de integridad. Revisa cada número contra tu propio documento antes de usarlo.',
        'This card is too large for a QR code. Share the link instead.': 'Esta tarjeta es demasiado grande para un código QR. Comparte el enlace en su lugar.',
        'This link is long — some chat apps will cut it. Send the image instead.': 'Este enlace es largo y algunas apps de mensajería lo cortan. Mejor envía la imagen.',
        'This browser could not turn the card into an image.': 'Este navegador no pudo convertir la tarjeta en imagen.',
        'Your browser blocked the pop-up. Allow pop-ups for this page and try again.': 'El navegador bloqueó la ventana emergente. Permite las ventanas emergentes en esta página e inténtalo de nuevo.',
        'Quote never answered — it may not have finished loading.': 'Quote nunca respondió: puede que no haya terminado de cargar.',
        'Quote opened but never confirmed it received the card.': 'Quote se abrió pero nunca confirmó que recibiera la tarjeta.',
        'Quote declined the card.': 'Quote rechazó la tarjeta.',
        'That copy of Quote is too old for this card. Reload Quote and try again.': 'Esa copia de Quote es demasiado antigua para esta tarjeta. Recarga Quote e inténtalo de nuevo.',
        'This page is too old for that copy of Quote. Reload this page and try again.': 'Esta página es demasiado antigua para esa copia de Quote. Recarga esta página e inténtalo de nuevo.',
        'The hand-off could not start. Reload this page and try again.': 'No se pudo iniciar el envío. Recarga esta página e inténtalo de nuevo.',
        'That tab was closed before the card arrived.': 'Esa pestaña se cerró antes de que llegara la tarjeta.',
        'The hand-off did not go through.': 'El envío no se completó.',

        // Backup, restore and erase. js/store.js throws 'not-json', 'not-a-backup'
        // or 'shape' for a file it cannot use, and otherwise reports how many
        // cards it added, skipped and dropped.
        'Restore from a backup': 'Restaurar desde un respaldo',
        'Choose a backup file, or paste one below.': 'Elige un archivo de respaldo, o pega uno abajo.',
        'Replace everything on this device': 'Reemplazar todo lo que hay en este dispositivo',
        '{n} cards restored': { one: '{n} tarjeta restaurada', other: '{n} tarjetas restauradas' },
        '{n} were already here and were skipped': { one: '{n} ya estaba aquí y se omitió', other: '{n} ya estaban aquí y se omitieron' },
        '{n} could not be read and were dropped': { one: '{n} no se pudo leer y se descartó', other: '{n} no se pudieron leer y se descartaron' },
        'That backup was written by a newer version, so some fields may be missing.': 'Ese respaldo lo escribió una versión más nueva, así que pueden faltar algunos campos.',
        'That file is not JSON.': 'Ese archivo no es JSON.',
        'That file is not a Carino Fiscal backup.': 'Ese archivo no es un respaldo de Carino Fiscal.',
        'That backup holds no cards.': 'Ese respaldo no tiene ninguna tarjeta.',
        'Erase everything': 'Borrar todo',
        'This deletes every card in this browser. It cannot be undone, and there is no copy anywhere else.': 'Esto elimina todas las tarjetas de este navegador. No se puede deshacer, y no hay copia en ningún otro lado.',
        'Everything on this device was erased.': 'Se borró todo lo que había en este dispositivo.',

        // Offline readiness and updates. The service worker answers an
        // OFFLINE_STATUS message with what it has still to fetch, and a new
        // build waits for the page to offer the reload rather than taking it.
        'Ready to use offline': 'Listo para usar sin conexión',
        'Still saving for offline use — {n} files to go.': 'Todavía se está guardando para usar sin conexión: faltan {n} archivos.',
        'A new version is ready.': 'Hay una versión nueva lista.',
        'Reload': 'Recargar',
        'Reloading will discard anything you are typing.': 'Al recargar se perderá lo que estés escribiendo.',
    },

    'pt-BR': {
        // Masthead
        'Skip to your cards': 'Ir para seus cartões',
        'Offline · nothing leaves this device': 'Offline · nada sai deste aparelho',
        "This card's address on this device": "Endereço deste cartão neste aparelho",
        "For any of {n} jurisdictions": "Para qualquer uma das {n} jurisdições",
        "check it": "confira",
        "Link": "Link",
        "The card itself, inside a link. Scanning it opens this card on any phone — the data rides after the “#”, so no server ever sees it.": "O cartão dentro de um link. Ao escanear, ele abre em qualquer celular — os dados vão depois do “#”, então nenhum servidor os vê.",
        "Your tax numbers for every country, ready to read out at the counter.": "Seus números fiscais de cada país, prontos para ditar no balcão.",
        "Works offline. Nothing leaves this device.": "Funciona offline. Nada sai deste aparelho.",
        "See it with sample cards": "Ver com cartões de exemplo",
        "Sample cards. Every number is invented but passes its country's real check-digit rule. Nothing here is saved.": "Cartões de exemplo. Todos os números são inventados, mas passam no dígito verificador real do país. Nada aqui é salvo.",
        "Leave samples": "Sair dos exemplos",
        "A card from a shared link. It is only being shown — nothing has been saved to this device.": "Um cartão de um link compartilhado. Só está sendo exibido — nada foi salvo neste aparelho.",
        "Keep this card": "Guardar este cartão",
        "The official catalogue was updated on {date}, after you last confirmed this card.": "O catálogo oficial foi atualizado em {date}, depois da última vez que você confirmou este cartão.",
        "Never confirmed against your own documents.": "Nunca conferido com seus próprios documentos.",
        "Last confirmed on {date}. Worth checking it still matches your records.": "Conferido pela última vez em {date}. Vale checar se ainda bate com seus registros.",
        "Confirmed {date}": "Confirmado em {date}",
        "E-invoicing mandatory": "Nota fiscal eletrônica obrigatória",
        "E-invoicing scheduled": "Nota fiscal eletrônica agendada",
        "E-invoicing partly in force": "Nota fiscal eletrônica parcialmente em vigor",
        "No e-invoicing mandate": "Sem obrigação de nota fiscal eletrônica",
        "Fill it from a document": "Preencha a partir de um documento",
        "Drop in the PDF the tax authority issued, or paste the text of one.": "Envie o PDF emitido pelo fisco, ou cole o texto dele.",
        "Paste any text holding your tax number — an email signature works.": "Cole qualquer texto com seu número fiscal — uma assinatura de e-mail serve.",
        "…or paste text here": "…ou cole o texto aqui",
        "Reading…": "Lendo…",
        "Read {n} fields from the document.": "{n} campos lidos do documento.",
        "Nothing recognisable found. Fill the fields below instead.": "Nada reconhecível encontrado. Preencha os campos abaixo.",
        "That file could not be read.": "Não foi possível ler esse arquivo.",
        "Share this card": "Compartilhar este cartão",
        "vCard": "vCard",
        "Carino payload": "Formato Carino",
        "A vCard — any phone camera reads this and offers to save it as a contact.": "Um vCard: a câmera de qualquer celular lê e oferece salvar como contato.",
        "A Carino payload — only this app reads it, kept for exchanging a card between your own devices.": "Um formato Carino: só este app lê; serve para passar um cartão entre seus próprios aparelhos.",
        "The QR encoder did not load.": "O codificador de QR não carregou.",
        "QR code for this card": "Código QR deste cartão",
        "Save as image": "Salvar como imagem",
        "Save .vcf": "Salvar .vcf",
        "Copy vCard": "Copiar vCard",
        "Copy link": "Copiar link",
        "Send to Quote": "Enviar para o Quote",
        "Opening Quote…": "Abrindo o Quote…",
        "Sent to Quote": "Enviado para o Quote",
        "Quote did not answer": "O Quote não respondeu",
        "The link carries the card after the “#”, which browsers never send to a server — so nothing is uploaded. It does sit in history and clipboards, so treat it as a share, not a secret.": "O link carrega o cartão depois do “#”, que os navegadores nunca enviam ao servidor — nada é enviado. Mas ele fica no histórico e na área de transferência, então trate como compartilhamento, não como segredo.",
        "Speak it": "Ler em voz alta",

        // Head — the tab title and the meta description, keyed on index.html
        'Carino Fiscal — your tax identity, offline, in any country': 'Carino Fiscal — sua identidade fiscal, offline, em qualquer país',
        'An offline card that holds your fiscal identity — personal and business — for every jurisdiction you file in. Check digits validated on device, spelled out phonetically for the counter, and never sent anywhere.': 'Um cartão offline com sua identidade fiscal — pessoal e da empresa — para cada país em que você declara. Os dígitos verificadores são validados no aparelho, soletrados para o balcão, e nunca enviados a lugar nenhum.',

        // Navbar (carino-navbar.js reads these through window.t)
        'Late shift.': 'Turno da madrugada.',
        'Good morning.': 'Bom dia.',
        'Good afternoon.': 'Boa tarde.',
        'Good evening.': 'Boa noite.',
        'Close': 'Fechar',

        // Jurisdiction
        'Tier': 'Nível',
        // The badge below reads 'Não verificado' and speaks about the number;
        // the pill speaks about the record, so it must not say the same thing.
        'unverified': 'registro não verificado',
        'Change': 'Trocar',
        'Jurisdiction': 'Jurisdição',
        'Checksum, invoice profile and delivery verified against the authority.': 'Dígito verificador, perfil de faturamento e entrega verificados junto à autoridade.',
        'Structure verified; invoice profile is not guaranteed.': 'Estrutura verificada; o perfil de faturamento não é garantido.',
        'Free-form record. Stored and presented, but nothing is validated.': 'Registro livre. Guardado e exibido, mas nada é validado.',
        '{n} of {total} jurisdictions': '{n} de {total} jurisdições',
        // The picker list is cut to 120 rows, so this count is a disclosure
        // rather than decoration: it has to say the rest are still there.
        'type to narrow': 'digite para filtrar',
        'your card': 'seu cartão',

        // Card kinds
        'Personal': 'Pessoal',
        'Business': 'Empresa',
        'personal': 'pessoal',
        'business': 'de empresa',
        'Card': 'Cartão',
        'No card yet': 'Ainda sem cartão',
        'Kind': 'Tipo',

        // Validation badges
        'Check digit valid': 'Dígito verificador correto',
        'Check digit does not match': 'O dígito verificador não confere',
        'Wrong format': 'Formato incorreto',
        'Format only — no published check digit': 'Somente formato — sem dígito verificador publicado',
        'Reserved official value': 'Valor oficial reservado',
        'Not checked': 'Não verificado',
        'Empty': 'Vazio',
        'expected': 'esperado',

        // Statuses the engine can return beyond a check digit that matched or
        // did not. Each has to read as a different verdict from 'Not checked':
        // a number the authority never issued is not a number nobody looked at.
        'Never issued by the authority': 'Nunca emitido pela autoridade',
        'The arithmetic fits, but this is a filler value the authority never issues.': 'A aritmética fecha, mas é um valor de preenchimento que a autoridade nunca emite.',
        'This app never stores this number': 'Este app nunca guarda este número',
        'A number the state uses to identify a person is refused on every card. Use the number your counter actually asks for.': 'Um número com que o Estado identifica uma pessoa é recusado em qualquer cartão. Use o número que o balcão realmente pede.',
        'Published rule this build does not run': 'Regra publicada que esta versão não executa',
        'The authority publishes a check rule for this identifier and this build does not run it, so the number has not been checked.': 'A autoridade publica uma regra de verificação para este identificador e esta versão não a executa, então o número não foi conferido.',
        'Worth reading back': 'Vale conferir de novo',
        'The check digit matched, but it cannot see the third character. Read that one back against your document.': 'O dígito verificador confere, mas não enxerga o terceiro caractere. Confira esse contra o seu documento.',
        'The check digit matched, but it cannot tell a 0 from a 9. Read every 0 and 9 back against your document.': 'O dígito verificador confere, mas não distingue 0 de 9. Confira cada 0 e cada 9 contra o seu documento.',

        // Actions
        'Copy': 'Copiar',
        'Copied': 'Copiado',
        'Copy all': 'Copiar tudo',
        'Counter mode': 'Modo balcão',
        'Share': 'Compartilhar',
        'Print': 'Imprimir',
        'Edit': 'Editar',
        'Save': 'Salvar',
        'Cancel': 'Cancelar',
        'Delete': 'Excluir',
        'Add card': 'Adicionar cartão',
        'Show official QR': 'Ver QR oficial',
        'Official QR': 'QR oficial',
        'The official QR image saved on this card': 'A imagem do QR oficial salva neste cartão',
        'Copy a backup': 'Copiar backup',

        // Empty state
        'No {kind} card for {country} yet': 'Ainda não há cartão {kind} para {country}',
        'Add one and it stays on this device — nothing is ever sent anywhere.': 'Adicione um e ele fica neste aparelho — nada é enviado a lugar nenhum.',
        'Example — not your data': 'Exemplo — não são seus dados',

        // Generic field labels — the fallback for a jurisdiction whose record
        // names no label of its own.
        'Legal name': 'Razão social',
        'Name': 'Nome',
        'Address': 'Endereço',
        'Email': 'E-mail',
        'Tax ID': 'Número fiscal',

        // Editor
        'Edit card': 'Editar cartão',
        'New card': 'Novo cartão',
        'Card name': 'Nome do cartão',
        'e.g. Carino Systems': 'ex. Carino Systems',
        'e.g. Personal': 'ex. Pessoal',
        'optional': 'opcional',
        'not stored': 'não é guardado',
        'Image stored': 'Imagem guardada',
        'That image is too large — keep it under 400 KB.': 'Essa imagem é grande demais: mantenha abaixo de 400 KB.',
        'That file could not be read as an image.': 'Não foi possível ler esse arquivo como imagem.',
        'Get it from the authority': 'Obter na autoridade',
        'Catalogue verified': 'Catálogo verificado',

        // Manage
        'Your cards': 'Seus cartões',

        // Counted strings carry Intl.PluralRules categories. 'other' doubles as
        // the form a caller that passes no count gets, so it has to be the
        // phrasing that is right for any number.
        '{n} cards on this device': { one: '{n} cartão neste aparelho', other: '{n} cartões neste aparelho' },
        'Nothing stored yet': 'Nada guardado ainda',

        // Privacy
        'No analytics, no sync, no account, no error reporting. The only things this page asks the network for are its own files from this domain, and not one request carries anything you typed.': 'Sem analytics, sem sincronização, sem conta, sem relatórios de erro. A única coisa que esta página pede à rede são os próprios arquivos deste domínio, e nenhuma requisição leva nada do que você digitou.',
        'Cards live in this browser, on this device only. Clearing site data deletes them, and no other device or browser can see them.': 'Os cartões ficam neste navegador e só neste aparelho. Limpar os dados do site apaga tudo, e nenhum outro aparelho ou navegador consegue vê-los.',
        'Some numbers are refused outright. A US Social Security Number and a Japanese My Number are never stored — the card editor explains why and what to use instead.': 'Alguns números são recusados de saída. O Social Security Number dos EUA e o My Number japonês nunca são guardados — o editor explica por quê e o que usar no lugar.',
        'Coverage:': 'Cobertura:',
        'every ISO 3166 jurisdiction is present —': 'todos os países e territórios da ISO 3166 estão presentes —',
        'in all. {t1} are verified against their authority, {t2} carry published structure, and the rest store and present without validating. Each card says which.': 'no total. {t1} são verificados junto à autoridade, {t2} trazem estrutura publicada, e o resto guarda e exibe sem validar. Cada cartão informa qual é o caso.',

        // Errors
        'The registry failed to load. Serve this folder over http:// rather than opening the file directly, or check that the registry/ directory is intact.': 'O registro não carregou. Sirva esta pasta por http:// em vez de abrir o arquivo direto, ou verifique se o diretório registry/ está intacto.',
        'This browser is not letting the page store anything, so cards will disappear when you reload. A private window or blocked site data is the usual cause.': 'Este navegador não está deixando a página guardar nada, então os cartões somem ao recarregar. Janela anônima ou dados de site bloqueados são a causa usual.',
        'Nothing was written to this device, so this will be gone when you reload.': 'Nada foi gravado neste dispositivo, então isto vai sumir quando você recarregar.',
        'Search {n} jurisdictions': 'Buscar entre {n} jurisdições',

        // Import review. js/import.js hands back a review rather than values, and
        // every code it can carry is named here: `problem` is why a document
        // yielded nothing, `reason` is why one candidate is not ticked.
        'Check what was read': 'Confira o que foi lido',
        'Nothing is filled in until you confirm.': 'Nada é preenchido até você confirmar.',
        'Use the ticked fields': 'Usar os campos marcados',
        'That PDF is password-protected. Unlock it and save a copy, or paste its text below.': 'Esse PDF está protegido por senha. Abra, salve uma cópia sem senha, ou cole o texto dele abaixo.',
        'That PDF is damaged and could not be read.': 'Esse PDF está danificado e não pôde ser lido.',
        'That file is empty.': 'Esse arquivo está vazio.',
        'That file is not a PDF.': 'Esse arquivo não é um PDF.',
        'That PDF holds no text — it is a scan or a photo. Type the fields in, or paste the text from somewhere else.': 'Esse PDF não tem texto — é um escaneamento ou uma foto. Digite os campos, ou cole o texto de outro lugar.',
        'That file is not text and cannot be read here.': 'Esse arquivo não é texto e não pode ser lido aqui.',
        'Only part of that document could be read. Check every field before you save.': 'Só foi possível ler parte desse documento. Confira cada campo antes de salvar.',
        'The PDF reader did not load, so PDFs cannot be opened here yet. Go online once to finish installing, or paste the text instead.': 'O leitor de PDF não carregou, então ainda não dá para abrir PDFs aqui. Conecte-se uma vez para concluir a instalação, ou cole o texto.',
        'Printed as somebody else’s number': 'Aparece como o número de outra pessoa',
        'Found without a label naming it': 'Encontrado sem um rótulo que o nomeie',
        'Recognised only by its shape': 'Reconhecido apenas pelo formato',
        'Completed by this app, not read from the document': 'Completado por este app; não foi lido do documento',
        'Two readings of this were possible': 'Havia duas leituras possíveis',
        'Only one of these can be right': 'Só um destes pode estar certo',
        'The same value was found twice': 'O mesmo valor foi encontrado duas vezes',
        'Another reading of this number fails its check digit — compare it with the paper.': 'Outra leitura deste número não passa no dígito verificador: confira com o papel.',
        'The document prints check digit {printed}, but the rule computes {expected}. Nothing was filled in — check the paper and type it.': 'O documento traz o dígito verificador {printed}, mas a regra calcula {expected}. Nada foi preenchido: confira o papel e digite.',
        '{n} numbers this app never stores were found and left out.': { one: '{n} número que este app nunca guarda foi encontrado e deixado de fora.', other: '{n} números que este app nunca guarda foram encontrados e deixados de fora.' },
        'The card name held a number this app never stores, so the card was saved without a name.': 'O nome do cartão continha um número que este app nunca guarda, então o cartão foi salvo sem nome.',
        'Not found in the document': 'Não foi encontrado no documento',
        'found beside “{label}”': 'encontrado ao lado de “{label}”',
        'found with no label': 'encontrado sem rótulo',
        'This document names {name} as the holder.': 'Este documento indica {name} como titular.',

        // Share and hand-off. A link that will not open and a card that did not
        // reach Quote each have several causes, and js/share.js separates them:
        // collapsing them sends four people out of five after the wrong problem.
        'That link is damaged and could not be read.': 'Esse link está danificado e não pôde ser lido.',
        'That link was made by a newer version of this app. Reload this page and open it again.': 'Esse link foi feito por uma versão mais nova deste app. Recarregue a página e abra de novo.',
        'That link carries a number this app never stores, so it was not opened.': 'Esse link traz um número que este app nunca guarda, então não foi aberto.',
        'That link is far longer than anything this app writes, so it was not opened.': 'Esse link é muito mais longo do que qualquer um que este app escreve, então não foi aberto.',
        'That card is for {country}, not this one.': 'Esse cartão é de {country}, não deste país.',
        'Link not verified': 'Link não verificado',
        'This link is from an older version and carries no integrity check. Read every number back against your own document before you use it.': 'Este link é de uma versão anterior e não traz verificação de integridade. Confira cada número com o seu próprio documento antes de usar.',
        'This card is too large for a QR code. Share the link instead.': 'Este cartão é grande demais para um QR code. Compartilhe o link no lugar.',
        'This link is long — some chat apps will cut it. Send the image instead.': 'Este link é longo e alguns apps de mensagem o cortam. Envie a imagem no lugar.',
        'This browser could not turn the card into an image.': 'Este navegador não conseguiu transformar o cartão em imagem.',
        'Your browser blocked the pop-up. Allow pop-ups for this page and try again.': 'O navegador bloqueou o pop-up. Permita pop-ups nesta página e tente de novo.',
        'Quote never answered — it may not have finished loading.': 'O Quote não respondeu — talvez não tenha terminado de carregar.',
        'Quote opened but never confirmed it received the card.': 'O Quote abriu, mas não confirmou que recebeu o cartão.',
        'Quote declined the card.': 'O Quote recusou o cartão.',
        'That copy of Quote is too old for this card. Reload Quote and try again.': 'Essa cópia do Quote é antiga demais para este cartão. Recarregue o Quote e tente de novo.',
        'This page is too old for that copy of Quote. Reload this page and try again.': 'Esta página é antiga demais para essa cópia do Quote. Recarregue esta página e tente de novo.',
        'The hand-off could not start. Reload this page and try again.': 'Não foi possível iniciar o envio. Recarregue esta página e tente de novo.',
        'That tab was closed before the card arrived.': 'Essa aba foi fechada antes de o cartão chegar.',
        'The hand-off did not go through.': 'O envio não foi concluído.',

        // Backup, restore and erase. js/store.js throws 'not-json', 'not-a-backup'
        // or 'shape' for a file it cannot use, and otherwise reports how many
        // cards it added, skipped and dropped.
        'Restore from a backup': 'Restaurar de um backup',
        'Choose a backup file, or paste one below.': 'Escolha um arquivo de backup, ou cole um abaixo.',
        'Replace everything on this device': 'Substituir tudo o que há neste aparelho',
        '{n} cards restored': { one: '{n} cartão restaurado', other: '{n} cartões restaurados' },
        '{n} were already here and were skipped': { one: '{n} já estava aqui e foi ignorado', other: '{n} já estavam aqui e foram ignorados' },
        '{n} could not be read and were dropped': { one: '{n} não pôde ser lido e foi descartado', other: '{n} não puderam ser lidos e foram descartados' },
        'That backup was written by a newer version, so some fields may be missing.': 'Esse backup foi escrito por uma versão mais nova, então alguns campos podem faltar.',
        'That file is not JSON.': 'Esse arquivo não é JSON.',
        'That file is not a Carino Fiscal backup.': 'Esse arquivo não é um backup do Carino Fiscal.',
        'That backup holds no cards.': 'Esse backup não tem nenhum cartão.',
        'Erase everything': 'Apagar tudo',
        'This deletes every card in this browser. It cannot be undone, and there is no copy anywhere else.': 'Isso apaga todos os cartões deste navegador. Não dá para desfazer, e não existe cópia em nenhum outro lugar.',
        'Everything on this device was erased.': 'Tudo o que havia neste aparelho foi apagado.',

        // Offline readiness and updates. The service worker answers an
        // OFFLINE_STATUS message with what it has still to fetch, and a new
        // build waits for the page to offer the reload rather than taking it.
        'Ready to use offline': 'Pronto para usar offline',
        'Still saving for offline use — {n} files to go.': 'Ainda salvando para uso offline — faltam {n} arquivos.',
        'A new version is ready.': 'Uma nova versão está pronta.',
        'Reload': 'Recarregar',
        'Reloading will discard anything you are typing.': 'Recarregar descarta o que você estiver digitando.',
    },

    ja: {
        // Masthead
        'Skip to your cards': 'カード一覧へ移動',
        'Offline · nothing leaves this device': 'オフライン・この端末から何も出ません',
        "This card's address on this device": "この端末でのこのカードのアドレス",
        "For any of {n} jurisdictions": "{n}の国・地域から選べます",
        "check it": "要確認",
        "Link": "リンク",
        "The card itself, inside a link. Scanning it opens this card on any phone — the data rides after the “#”, so no server ever sees it.": "カードをリンクに載せたものです。読み取ればどの端末でも開きます。データは「#」より後ろにあるため、サーバーには届きません。",
        "Your tax numbers for every country, ready to read out at the counter.": "各国の税務番号を、窓口でそのまま読み上げられる形で。",
        "Works offline. Nothing leaves this device.": "オフラインで動作。データは端末から出ません。",
        "See it with sample cards": "サンプルカードで見る",
        "Sample cards. Every number is invented but passes its country's real check-digit rule. Nothing here is saved.": "サンプルカードです。番号はすべて架空ですが、各国の本物のチェックディジット規則を満たします。保存はされません。",
        "Leave samples": "サンプルを終了",
        "A card from a shared link. It is only being shown — nothing has been saved to this device.": "共有リンクのカードです。表示しているだけで、この端末には何も保存していません。",
        "Keep this card": "このカードを保存",
        "The official catalogue was updated on {date}, after you last confirmed this card.": "公式カタログは{date}に更新されました。あなたが最後に確認した日より後です。",
        "Never confirmed against your own documents.": "ご自身の書類と照合したことがありません。",
        "Last confirmed on {date}. Worth checking it still matches your records.": "最終確認は{date}です。記録と一致しているか確認をおすすめします。",
        "Confirmed {date}": "{date}に確認済み",
        "E-invoicing mandatory": "電子インボイス必須",
        "E-invoicing scheduled": "電子インボイス導入予定",
        "E-invoicing partly in force": "電子インボイス一部適用",
        "No e-invoicing mandate": "電子インボイスの義務なし",
        "Fill it from a document": "書類から入力",
        "Drop in the PDF the tax authority issued, or paste the text of one.": "税務当局が発行したPDFを選ぶか、その本文を貼り付けてください。",
        "Paste any text holding your tax number — an email signature works.": "税務番号を含む文章を貼り付けてください。メール署名でも構いません。",
        "…or paste text here": "…またはここに貼り付け",
        "Reading…": "読み取り中…",
        "Read {n} fields from the document.": "書類から{n}件の項目を読み取りました。",
        "Nothing recognisable found. Fill the fields below instead.": "認識できる内容がありませんでした。下の項目に入力してください。",
        "That file could not be read.": "そのファイルは読み取れませんでした。",
        "Share this card": "このカードを共有",
        "vCard": "vCard",
        "Carino payload": "Carino形式",
        "A vCard — any phone camera reads this and offers to save it as a contact.": "vCardです。どのスマホのカメラでも読み取り、連絡先として保存できます。",
        "A Carino payload — only this app reads it, kept for exchanging a card between your own devices.": "Carino形式です。このアプリだけが読み取れ、自分の端末間でカードを渡すのに使います。",
        "The QR encoder did not load.": "QRエンコーダを読み込めませんでした。",
        "QR code for this card": "このカードのQRコード",
        "Save as image": "画像として保存",
        "Save .vcf": ".vcfを保存",
        "Copy vCard": "vCardをコピー",
        "Copy link": "リンクをコピー",
        "Send to Quote": "Quoteへ送る",
        "Opening Quote…": "Quoteを開いています…",
        "Sent to Quote": "Quoteへ送りました",
        "Quote did not answer": "Quoteが応答しませんでした",
        "The link carries the card after the “#”, which browsers never send to a server — so nothing is uploaded. It does sit in history and clipboards, so treat it as a share, not a secret.": "リンクは「#」より後ろにカードを載せます。ブラウザはこの部分をサーバーへ送りません。ただし履歴やクリップボードには残るため、秘密ではなく共有物として扱ってください。",
        "Speak it": "読み上げる",

        // Head — the tab title and the meta description, keyed on index.html
        'Carino Fiscal — your tax identity, offline, in any country': 'Carino Fiscal — 税務情報を、オフラインで、どの国でも',
        'An offline card that holds your fiscal identity — personal and business — for every jurisdiction you file in. Check digits validated on device, spelled out phonetically for the counter, and never sent anywhere.': 'オフラインで使える税務情報カードです。申告するすべての国について、個人と法人の情報をまとめて保管します。チェックディジットは端末内で検証し、窓口で読み上げやすい形に展開します。データはどこにも送信されません。',

        // Navbar (carino-navbar.js reads these through window.t)
        'Late shift.': '夜勤中。',
        'Good morning.': 'おはようございます。',
        'Good afternoon.': 'こんにちは。',
        'Good evening.': 'こんばんは。',
        'Close': '閉じる',

        // Jurisdiction
        'Tier': '段階',
        // The badge below reads 未検証 and speaks about the number; the pill
        // speaks about the record, and the obvious translation of both is the
        // same word on a card that shows them side by side.
        'unverified': '当局未照合',
        'Change': '変更',
        'Jurisdiction': '国・地域',
        'Checksum, invoice profile and delivery verified against the authority.': 'チェックディジット、請求項目、提示方法を当局の公表資料と照合済み。',
        'Structure verified; invoice profile is not guaranteed.': '書式は検証済み。請求項目は保証されません。',
        'Free-form record. Stored and presented, but nothing is validated.': '自由記入の記録です。保存と表示のみで、検証は行いません。',
        '{n} of {total} jurisdictions': '{total}件中{n}件',
        // The picker list is cut to 120 rows, so this count is a disclosure
        // rather than decoration: it has to say the rest are still there.
        'type to narrow': '入力して絞り込み',
        'your card': '登録済み',

        // Card kinds
        'Personal': '個人',
        'Business': '法人',
        'personal': '個人',
        'business': '法人',
        'Card': 'カード',
        'No card yet': 'カード未登録',
        'Kind': '種別',

        // Validation badges
        'Check digit valid': 'チェックディジット正常',
        'Check digit does not match': 'チェックディジットが一致しません',
        'Wrong format': '書式が違います',
        'Format only — no published check digit': '書式のみ — 公表されたチェックディジットなし',
        'Reserved official value': '公式の予約値',
        'Not checked': '未検証',
        'Empty': '未入力',
        'expected': '正しくは',

        // Statuses the engine can return beyond a check digit that matched or
        // did not. Each has to read as a different verdict from 'Not checked':
        // a number the authority never issued is not a number nobody looked at.
        'Never issued by the authority': '当局が発行しない値',
        'The arithmetic fits, but this is a filler value the authority never issues.': '計算は合いますが、当局が発行しないダミー値です。',
        'This app never stores this number': 'このアプリでは保存しません',
        'A number the state uses to identify a person is refused on every card. Use the number your counter actually asks for.': '国が個人を特定するための番号は、どのカードでも受け付けません。窓口が実際に求める番号を使ってください。',
        'Published rule this build does not run': '公表された検証規則が未実装',
        'The authority publishes a check rule for this identifier and this build does not run it, so the number has not been checked.': 'この識別子には当局が検証規則を公表していますが、このビルドは実行していないため、番号は未確認です。',
        'Worth reading back': '読み直す価値あり',
        'The check digit matched, but it cannot see the third character. Read that one back against your document.': 'チェックディジットは一致しましたが、3文字目は計算に入っていません。その1文字を書類と照合してください。',
        'The check digit matched, but it cannot tell a 0 from a 9. Read every 0 and 9 back against your document.': 'チェックディジットは一致しましたが、0と9を区別できません。0と9をすべて書類と照合してください。',

        // Actions
        'Copy': 'コピー',
        'Copied': 'コピーしました',
        'Copy all': 'すべてコピー',
        'Counter mode': '窓口モード',
        'Share': '共有',
        'Print': '印刷',
        'Edit': '編集',
        'Save': '保存',
        'Cancel': 'キャンセル',
        'Delete': '削除',
        'Add card': 'カードを追加',
        'Show official QR': '公式QRを表示',
        'Official QR': '公式QR',
        'The official QR image saved on this card': 'このカードに保存されている公式QRの画像',
        'Copy a backup': 'バックアップをコピー',

        // Empty state
        'No {kind} card for {country} yet': '{country}の{kind}カードはまだありません',
        'Add one and it stays on this device — nothing is ever sent anywhere.': '追加してもこの端末に残るだけで、どこにも送信されません。',
        'Example — not your data': '例 — あなたのデータではありません',

        // Generic field labels — the fallback for a jurisdiction whose record
        // names no label of its own.
        'Legal name': '正式名称',
        'Name': '氏名',
        'Address': '住所',
        'Email': 'メールアドレス',
        'Tax ID': '税務番号',

        // Editor
        'Edit card': 'カードを編集',
        'New card': '新しいカード',
        'Card name': 'カード名',
        'e.g. Carino Systems': '例: Carino Systems',
        'e.g. Personal': '例: 個人',
        'optional': '任意',
        'not stored': '保存しません',
        'Image stored': '画像を保存しました',
        'That image is too large — keep it under 400 KB.': '画像が大きすぎます。400KB以下にしてください。',
        'That file could not be read as an image.': 'そのファイルは画像として読み込めませんでした。',
        'Get it from the authority': '当局のサイトで取得',
        'Catalogue verified': 'カタログ確認日',

        // Manage
        'Your cards': '登録カード',

        // Counted strings carry Intl.PluralRules categories. 'other' doubles as
        // the form a caller that passes no count gets, so it has to be the
        // phrasing that is right for any number.
        '{n} cards on this device': 'この端末に{n}件',
        'Nothing stored yet': 'まだ何も保存されていません',

        // Privacy
        'No analytics, no sync, no account, no error reporting. The only things this page asks the network for are its own files from this domain, and not one request carries anything you typed.': '解析も同期もアカウントもエラー報告もありません。このページがネットワークに求めるのはこのドメイン上の自身のファイルだけで、入力した内容はどの通信にも含まれません。',
        'Cards live in this browser, on this device only. Clearing site data deletes them, and no other device or browser can see them.': 'カードはこのブラウザ、この端末だけに保存されます。サイトデータを消すと削除され、他の端末やブラウザからは見えません。',
        'Some numbers are refused outright. A US Social Security Number and a Japanese My Number are never stored — the card editor explains why and what to use instead.': '一部の番号は保存自体を拒否します。米国のSSNと日本のマイナンバーは保存されません。理由と代わりに使う番号は編集画面に表示されます。',
        'Coverage:': '対象範囲:',
        'every ISO 3166 jurisdiction is present —': 'ISO 3166のすべての国・地域を収録 —',
        'in all. {t1} are verified against their authority, {t2} carry published structure, and the rest store and present without validating. Each card says which.': '件。うち{t1}件は当局と照合済み、{t2}件は公表書式に基づき、残りは検証せず保存・表示のみです。どれに当たるかは各カードに表示されます。',

        // Errors
        'The registry failed to load. Serve this folder over http:// rather than opening the file directly, or check that the registry/ directory is intact.': 'レジストリを読み込めませんでした。ファイルを直接開かず http:// で配信するか、registry/ ディレクトリが揃っているか確認してください。',
        'This browser is not letting the page store anything, so cards will disappear when you reload. A private window or blocked site data is the usual cause.': 'このブラウザが保存を許可していないため、再読み込みでカードが消えます。プライベートウィンドウやサイトデータのブロックが主な原因です。',
        'Nothing was written to this device, so this will be gone when you reload.': 'この端末には何も書き込まれていないため、再読み込みすると消えます。',
        'Search {n} jurisdictions': '{n}の国・地域を検索',

        // Import review. js/import.js hands back a review rather than values, and
        // every code it can carry is named here: `problem` is why a document
        // yielded nothing, `reason` is why one candidate is not ticked.
        'Check what was read': '読み取った内容を確認',
        'Nothing is filled in until you confirm.': '確認するまで、何も入力されません。',
        'Use the ticked fields': 'チェックした項目を使う',
        'That PDF is password-protected. Unlock it and save a copy, or paste its text below.': 'そのPDFはパスワードで保護されています。解除したコピーを保存するか、下にテキストを貼り付けてください。',
        'That PDF is damaged and could not be read.': 'そのPDFは壊れていて読めませんでした。',
        'That file is empty.': 'そのファイルは空です。',
        'That file is not a PDF.': 'そのファイルはPDFではありません。',
        'That PDF holds no text — it is a scan or a photo. Type the fields in, or paste the text from somewhere else.': 'そのPDFにはテキストがありません。スキャンか写真です。項目を手で入力するか、別の場所からテキストを貼り付けてください。',
        'That file is not text and cannot be read here.': 'そのファイルはテキストではないため、ここでは読めません。',
        'Only part of that document could be read. Check every field before you save.': 'その書類は一部しか読めませんでした。保存する前に、すべての項目を確認してください。',
        'The PDF reader did not load, so PDFs cannot be opened here yet. Go online once to finish installing, or paste the text instead.': 'PDFリーダーを読み込めなかったため、まだPDFを開けません。一度オンラインにして導入を終えるか、テキストを貼り付けてください。',
        'Printed as somebody else’s number': '他人の番号として印字されています',
        'Found without a label naming it': '項目名がない状態で見つかりました',
        'Recognised only by its shape': '書式だけで判断しました',
        'Completed by this app, not read from the document': 'このアプリが補完した値で、書類から読んだものではありません',
        'Two readings of this were possible': '読み方が2通りありました',
        'Only one of these can be right': 'このうち正しいのは1つだけです',
        'The same value was found twice': '同じ値が2回見つかりました',
        'Another reading of this number fails its check digit — compare it with the paper.': 'この番号の別の読み取りではチェックディジットが合いません。書類と照合してください。',
        'The document prints check digit {printed}, but the rule computes {expected}. Nothing was filled in — check the paper and type it.': '書類にはチェックディジット{printed}と印字されていますが、規則では{expected}になります。何も入力していません。書類を確認して手で入力してください。',
        '{n} numbers this app never stores were found and left out.': 'このアプリが保存しない番号が{n}件見つかり、除外しました。',
        'The card name held a number this app never stores, so the card was saved without a name.': 'カード名にこのアプリが保存しない番号が含まれていたため、名前を空にして保存しました。',
        'Not found in the document': '書類には見つかりませんでした',
        'found beside “{label}”': '「{label}」の横で検出',
        'found with no label': 'ラベルなしで検出',
        'This document names {name} as the holder.': 'この書類は名義人を{name}としています。',

        // Share and hand-off. A link that will not open and a card that did not
        // reach Quote each have several causes, and js/share.js separates them:
        // collapsing them sends four people out of five after the wrong problem.
        'That link is damaged and could not be read.': 'そのリンクは壊れていて読めませんでした。',
        'That link was made by a newer version of this app. Reload this page and open it again.': 'そのリンクはこのアプリの新しいバージョンで作られています。ページを再読み込みしてから開いてください。',
        'That link carries a number this app never stores, so it was not opened.': 'そのリンクにはこのアプリが保存しない番号が含まれているため、開きませんでした。',
        'That link is far longer than anything this app writes, so it was not opened.': 'そのリンクはこのアプリが作るどのリンクよりも長いため、開きませんでした。',
        'That card is for {country}, not this one.': 'そのカードは{country}のもので、この国のものではありません。',
        'Link not verified': 'リンク未検証',
        'This link is from an older version and carries no integrity check. Read every number back against your own document before you use it.': 'このリンクは古いバージョンのもので、改変を検出する仕組みがありません。使う前に、すべての番号を自分の書類と照合してください。',
        'This card is too large for a QR code. Share the link instead.': 'このカードはQRコードには大きすぎます。代わりにリンクを共有してください。',
        'This link is long — some chat apps will cut it. Send the image instead.': 'このリンクは長いため、切り詰めるメッセージアプリがあります。代わりに画像を送ってください。',
        'This browser could not turn the card into an image.': 'このブラウザーではカードを画像に変換できませんでした。',
        'Your browser blocked the pop-up. Allow pop-ups for this page and try again.': 'ブラウザーがポップアップをブロックしました。このページのポップアップを許可して、もう一度お試しください。',
        'Quote never answered — it may not have finished loading.': 'Quoteから応答がありませんでした。読み込みが終わっていない可能性があります。',
        'Quote opened but never confirmed it received the card.': 'Quoteは開きましたが、カードを受け取ったという確認がありませんでした。',
        'Quote declined the card.': 'Quoteがカードを受け取りませんでした。',
        'That copy of Quote is too old for this card. Reload Quote and try again.': 'そのQuoteはこのカードには古すぎます。Quoteを再読み込みしてお試しください。',
        'This page is too old for that copy of Quote. Reload this page and try again.': 'このページはそのQuoteには古すぎます。このページを再読み込みしてお試しください。',
        'The hand-off could not start. Reload this page and try again.': '受け渡しを開始できませんでした。ページを再読み込みしてお試しください。',
        'That tab was closed before the card arrived.': 'カードが届く前に、そのタブが閉じられました。',
        'The hand-off did not go through.': '受け渡しは完了しませんでした。',

        // Backup, restore and erase. js/store.js throws 'not-json', 'not-a-backup'
        // or 'shape' for a file it cannot use, and otherwise reports how many
        // cards it added, skipped and dropped.
        'Restore from a backup': 'バックアップから復元',
        'Choose a backup file, or paste one below.': 'バックアップファイルを選ぶか、下に貼り付けてください。',
        'Replace everything on this device': 'この端末の内容をすべて置き換える',
        '{n} cards restored': '{n}件を復元しました',
        '{n} were already here and were skipped': '{n}件はすでにあったため飛ばしました',
        '{n} could not be read and were dropped': '{n}件は読めなかったため取り込みませんでした',
        'That backup was written by a newer version, so some fields may be missing.': 'そのバックアップは新しいバージョンで作られているため、一部の項目が欠けている場合があります。',
        'That file is not JSON.': 'そのファイルはJSONではありません。',
        'That file is not a Carino Fiscal backup.': 'そのファイルはCarino Fiscalのバックアップではありません。',
        'That backup holds no cards.': 'そのバックアップにはカードが入っていません。',
        'Erase everything': 'すべて消去',
        'This deletes every card in this browser. It cannot be undone, and there is no copy anywhere else.': 'このブラウザーのカードをすべて削除します。取り消せません。ほかの場所に控えはありません。',
        'Everything on this device was erased.': 'この端末の内容をすべて消去しました。',

        // Offline readiness and updates. The service worker answers an
        // OFFLINE_STATUS message with what it has still to fetch, and a new
        // build waits for the page to offer the reload rather than taking it.
        'Ready to use offline': 'オフラインで使えます',
        'Still saving for offline use — {n} files to go.': 'オフライン用に保存中です。残り{n}件。',
        'A new version is ready.': '新しいバージョンの準備ができました。',
        'Reload': '再読み込み',
        'Reloading will discard anything you are typing.': '再読み込みすると、入力中の内容は失われます。',
    },

    ru: {
        // Masthead
        'Skip to your cards': 'Перейти к картам',
        'Offline · nothing leaves this device': 'Офлайн · ничего не покидает это устройство',
        "This card's address on this device": "Адрес этой карты на этом устройстве",
        "For any of {n} jurisdictions": "Для любой из {n} юрисдикций",
        "check it": "проверьте",
        "Link": "Ссылка",
        "The card itself, inside a link. Scanning it opens this card on any phone — the data rides after the “#”, so no server ever sees it.": "Сама карта внутри ссылки. Сканирование открывает её на любом телефоне — данные идут после «#», поэтому сервер их не видит.",
        "Your tax numbers for every country, ready to read out at the counter.": "Ваши налоговые номера для каждой страны — готовые продиктовать на стойке.",
        "Works offline. Nothing leaves this device.": "Работает офлайн. Ничего не покидает это устройство.",
        "See it with sample cards": "Посмотреть на примерах",
        "Sample cards. Every number is invented but passes its country's real check-digit rule. Nothing here is saved.": "Примеры карт. Все номера вымышленные, но проходят настоящую проверку контрольной цифры своей страны. Ничего не сохраняется.",
        "Leave samples": "Выйти из примеров",
        "A card from a shared link. It is only being shown — nothing has been saved to this device.": "Карта из присланной ссылки. Она только показана — на устройство ничего не сохранено.",
        "Keep this card": "Сохранить эту карту",
        "The official catalogue was updated on {date}, after you last confirmed this card.": "Официальный справочник обновлён {date} — после того, как вы в последний раз подтверждали эту карту.",
        "Never confirmed against your own documents.": "Ни разу не сверялась с вашими документами.",
        "Last confirmed on {date}. Worth checking it still matches your records.": "Последнее подтверждение: {date}. Стоит проверить, что данные всё ещё верны.",
        "Confirmed {date}": "Подтверждено {date}",
        "E-invoicing mandatory": "Электронные счета обязательны",
        "E-invoicing scheduled": "Электронные счета запланированы",
        "E-invoicing partly in force": "Электронные счета частично введены",
        "No e-invoicing mandate": "Обязательства по электронным счетам нет",
        "Fill it from a document": "Заполнить из документа",
        "Drop in the PDF the tax authority issued, or paste the text of one.": "Загрузите PDF, выданный налоговым органом, или вставьте его текст.",
        "Paste any text holding your tax number — an email signature works.": "Вставьте любой текст с вашим налоговым номером — подойдёт и подпись из письма.",
        "…or paste text here": "…или вставьте текст сюда",
        "Reading…": "Чтение…",
        "Read {n} fields from the document.": "Из документа считано полей: {n}.",
        "Nothing recognisable found. Fill the fields below instead.": "Ничего распознать не удалось. Заполните поля ниже.",
        "That file could not be read.": "Не удалось прочитать этот файл.",
        "Share this card": "Поделиться картой",
        "vCard": "vCard",
        "Carino payload": "Формат Carino",
        "A vCard — any phone camera reads this and offers to save it as a contact.": "vCard: камера любого телефона прочитает и предложит сохранить как контакт.",
        "A Carino payload — only this app reads it, kept for exchanging a card between your own devices.": "Формат Carino: читает только это приложение — для переноса карты между своими устройствами.",
        "The QR encoder did not load.": "Кодировщик QR не загрузился.",
        "QR code for this card": "QR-код этой карточки",
        "Save as image": "Сохранить как изображение",
        "Save .vcf": "Сохранить .vcf",
        "Copy vCard": "Скопировать vCard",
        "Copy link": "Скопировать ссылку",
        "Send to Quote": "Отправить в Quote",
        "Opening Quote…": "Открываем Quote…",
        "Sent to Quote": "Отправлено в Quote",
        "Quote did not answer": "Quote не ответил",
        "The link carries the card after the “#”, which browsers never send to a server — so nothing is uploaded. It does sit in history and clipboards, so treat it as a share, not a secret.": "Ссылка несёт карту после «#», а эту часть браузеры никогда не отправляют на сервер — ничего не загружается. Но она остаётся в истории и буфере обмена, так что это обмен, а не секрет.",
        "Speak it": "Прочитать вслух",

        // Head — the tab title and the meta description, keyed on index.html
        'Carino Fiscal — your tax identity, offline, in any country': 'Carino Fiscal — ваши налоговые данные офлайн, в любой стране',
        'An offline card that holds your fiscal identity — personal and business — for every jurisdiction you file in. Check digits validated on device, spelled out phonetically for the counter, and never sent anywhere.': 'Офлайн-карта с вашими налоговыми данными — личными и по компании — для каждой юрисдикции, где вы отчитываетесь. Контрольные цифры проверяются на устройстве, номер раскладывается по буквам для стойки, и ничего никуда не отправляется.',

        // Navbar (carino-navbar.js reads these through window.t)
        'Late shift.': 'Ночная смена.',
        'Good morning.': 'Доброе утро.',
        'Good afternoon.': 'Добрый день.',
        'Good evening.': 'Добрый вечер.',
        'Close': 'Закрыть',

        // Jurisdiction
        'Tier': 'Уровень',
        'unverified': 'без проверки',
        'Change': 'Сменить',
        'Jurisdiction': 'Юрисдикция',
        'Checksum, invoice profile and delivery verified against the authority.': 'Контрольная цифра, состав реквизитов и способ передачи сверены с ведомством.',
        'Structure verified; invoice profile is not guaranteed.': 'Структура проверена; состав реквизитов не гарантирован.',
        'Free-form record. Stored and presented, but nothing is validated.': 'Свободная запись. Хранится и показывается, но не проверяется.',
        '{n} of {total} jurisdictions': '{n} из {total} юрисдикций',
        // The picker list is cut to 120 rows, so this count is a disclosure
        // rather than decoration: it has to say the rest are still there.
        'type to narrow': 'введите запрос, чтобы сузить список',
        'your card': 'ваша карта',

        // Card kinds. The lower-case pair fills the {kind} slot of the empty
        // state, which is a genitive-feminine adjective agreeing with "карты";
        // the standalone pair is a noun and does not fit there.
        'Personal': 'Личная',
        'Business': 'Компания',
        'personal': 'личной',
        'business': 'корпоративной',
        'Card': 'Карта',
        'No card yet': 'Карты пока нет',
        'Kind': 'Тип',

        // Validation badges
        'Check digit valid': 'Контрольная цифра верна',
        'Check digit does not match': 'Контрольная цифра не совпадает',
        'Wrong format': 'Неверный формат',
        'Format only — no published check digit': 'Только формат — контрольная цифра не публикуется',
        'Reserved official value': 'Зарезервированное официальное значение',
        'Not checked': 'Не проверено',
        'Empty': 'Пусто',
        'expected': 'ожидалось',

        // Statuses the engine can return beyond a check digit that matched or
        // did not. Each has to read as a different verdict from 'Not checked':
        // a number the authority never issued is not a number nobody looked at.
        'Never issued by the authority': 'Такой номер не выдаётся',
        'The arithmetic fits, but this is a filler value the authority never issues.': 'Арифметика сходится, но такое значение налоговый орган не выдаёт.',
        'This app never stores this number': 'Приложение не хранит такой номер',
        'A number the state uses to identify a person is refused on every card. Use the number your counter actually asks for.': 'Номер, которым государство идентифицирует человека, не принимается ни на одной карте. Используйте тот номер, который действительно спрашивают в окне.',
        'Published rule this build does not run': 'Правило опубликовано, но не выполняется',
        'The authority publishes a check rule for this identifier and this build does not run it, so the number has not been checked.': 'Для этого идентификатора налоговый орган публикует правило проверки, но эта сборка его не выполняет, поэтому номер не проверен.',
        'Worth reading back': 'Стоит перечитать',
        'The check digit matched, but it cannot see the third character. Read that one back against your document.': 'Контрольная цифра сошлась, но третий символ в неё не входит. Сверьте именно его с документом.',
        'The check digit matched, but it cannot tell a 0 from a 9. Read every 0 and 9 back against your document.': 'Контрольная цифра сошлась, но она не отличает 0 от 9. Сверьте каждый 0 и каждую 9 с документом.',

        // Actions
        'Copy': 'Копировать',
        'Copied': 'Скопировано',
        'Copy all': 'Копировать всё',
        'Counter mode': 'Режим стойки',
        'Share': 'Поделиться',
        'Print': 'Печать',
        'Edit': 'Изменить',
        'Save': 'Сохранить',
        'Cancel': 'Отмена',
        'Delete': 'Удалить',
        'Add card': 'Добавить карту',
        'Show official QR': 'Показать официальный QR',
        'Official QR': 'Официальный QR',
        'The official QR image saved on this card': 'Изображение официального QR-кода, сохранённое на этой карточке',
        'Copy a backup': 'Скопировать резервную копию',

        // Empty state
        'No {kind} card for {country} yet': 'Для страны {country} ещё нет {kind} карты',
        'Add one and it stays on this device — nothing is ever sent anywhere.': 'Добавьте — она останется на этом устройстве, никуда не отправляясь.',
        'Example — not your data': 'Пример — это не ваши данные',

        // Generic field labels — the fallback for a jurisdiction whose record
        // names no label of its own.
        'Legal name': 'Юридическое наименование',
        'Name': 'Имя',
        'Address': 'Адрес',
        'Email': 'Электронная почта',
        'Tax ID': 'Налоговый номер',

        // Editor
        'Edit card': 'Изменить карту',
        'New card': 'Новая карта',
        'Card name': 'Название карты',
        'e.g. Carino Systems': 'напр. Carino Systems',
        'e.g. Personal': 'напр. Личная',
        'optional': 'необязательно',
        'not stored': 'не хранится',
        'Image stored': 'Изображение сохранено',
        'That image is too large — keep it under 400 KB.': 'Изображение слишком большое — не более 400 КБ.',
        'That file could not be read as an image.': 'Не удалось прочитать файл как изображение.',
        'Get it from the authority': 'Получить в ведомстве',
        'Catalogue verified': 'Справочник сверен',

        // Manage
        'Your cards': 'Ваши карты',

        // Counted strings carry Intl.PluralRules categories. 'other' doubles as
        // the form a caller that passes no count gets, so it has to be the
        // phrasing that is right for any number.
        '{n} cards on this device': { one: 'На устройстве {n} карта', few: 'На устройстве {n} карты', many: 'На устройстве {n} карт', other: 'Карт на устройстве: {n}' },
        'Nothing stored yet': 'Пока ничего не сохранено',

        // Privacy
        'No analytics, no sync, no account, no error reporting. The only things this page asks the network for are its own files from this domain, and not one request carries anything you typed.': 'Никакой аналитики, синхронизации, учётных записей и отчётов об ошибках. Из сети эта страница запрашивает только собственные файлы с этого домена, и ни один запрос не несёт того, что вы ввели.',
        'Cards live in this browser, on this device only. Clearing site data deletes them, and no other device or browser can see them.': 'Карты живут в этом браузере и только на этом устройстве. Очистка данных сайта удаляет их, и никакое другое устройство или браузер их не видит.',
        'Some numbers are refused outright. A US Social Security Number and a Japanese My Number are never stored — the card editor explains why and what to use instead.': 'Некоторые номера не принимаются вовсе. Американский SSN и японский My Number не сохраняются — редактор объясняет почему и что использовать вместо них.',
        'Coverage:': 'Охват:',
        'every ISO 3166 jurisdiction is present —': 'присутствуют все юрисдикции ISO 3166 —',
        'in all. {t1} are verified against their authority, {t2} carry published structure, and the rest store and present without validating. Each card says which.': 'всего. {t1} сверены с ведомством, {t2} содержат опубликованную структуру, остальные хранятся и показываются без проверки. Каждая карта это указывает.',

        // Errors
        'The registry failed to load. Serve this folder over http:// rather than opening the file directly, or check that the registry/ directory is intact.': 'Реестр не загрузился. Откройте папку по http://, а не файлом напрямую, либо проверьте целостность каталога registry/.',
        'This browser is not letting the page store anything, so cards will disappear when you reload. A private window or blocked site data is the usual cause.': 'Браузер не разрешает странице ничего сохранять, поэтому карты исчезнут при перезагрузке. Обычно причина — приватное окно или заблокированные данные сайта.',
        'Nothing was written to this device, so this will be gone when you reload.': 'На это устройство ничего не записано, поэтому при перезагрузке это исчезнет.',
        'Search {n} jurisdictions': 'Поиск по {n} юрисдикциям',

        // Import review. js/import.js hands back a review rather than values, and
        // every code it can carry is named here: `problem` is why a document
        // yielded nothing, `reason` is why one candidate is not ticked.
        'Check what was read': 'Проверьте, что распозналось',
        'Nothing is filled in until you confirm.': 'Ничего не заполняется, пока вы не подтвердите.',
        'Use the ticked fields': 'Использовать отмеченные поля',
        'That PDF is password-protected. Unlock it and save a copy, or paste its text below.': 'Этот PDF защищён паролем. Сохраните копию без пароля или вставьте его текст ниже.',
        'That PDF is damaged and could not be read.': 'Этот PDF повреждён и не читается.',
        'That file is empty.': 'Этот файл пуст.',
        'That file is not a PDF.': 'Это не PDF-файл.',
        'That PDF holds no text — it is a scan or a photo. Type the fields in, or paste the text from somewhere else.': 'В этом PDF нет текста — это скан или фотография. Введите поля вручную или вставьте текст из другого места.',
        'That file is not text and cannot be read here.': 'Этот файл не текстовый и здесь не читается.',
        'Only part of that document could be read. Check every field before you save.': 'Документ прочитан лишь частично. Проверьте каждое поле перед сохранением.',
        'The PDF reader did not load, so PDFs cannot be opened here yet. Go online once to finish installing, or paste the text instead.': 'Программа чтения PDF не загрузилась, поэтому PDF пока не открыть. Подключитесь один раз, чтобы завершить установку, или вставьте текст.',
        'Printed as somebody else’s number': 'Напечатан как чужой номер',
        'Found without a label naming it': 'Найден без подписи, которая его называет',
        'Recognised only by its shape': 'Распознан только по виду',
        'Completed by this app, not read from the document': 'Дополнено приложением, а не прочитано из документа',
        'Two readings of this were possible': 'Возможны два прочтения',
        'Only one of these can be right': 'Верным может быть только один из них',
        'The same value was found twice': 'Одно и то же значение найдено дважды',
        'Another reading of this number fails its check digit — compare it with the paper.': 'Другое прочтение этого номера не проходит проверку контрольной цифры — сверьте с документом.',
        'The document prints check digit {printed}, but the rule computes {expected}. Nothing was filled in — check the paper and type it.': 'В документе напечатана контрольная цифра {printed}, а по правилу выходит {expected}. Ничего не заполнено — сверьтесь с бумагой и введите вручную.',
        '{n} numbers this app never stores were found and left out.': { one: 'Найден {n} номер, который приложение не хранит, — он пропущен.', few: 'Найдено {n} номера, которые приложение не хранит, — они пропущены.', many: 'Найдено {n} номеров, которые приложение не хранит, — они пропущены.', other: 'Номеров, которые приложение не хранит, найдено и пропущено: {n}.' },
        'The card name held a number this app never stores, so the card was saved without a name.': 'В названии карточки был номер, который это приложение не хранит, поэтому карточка сохранена без названия.',
        'Not found in the document': 'В документе не найдено',
        'found beside “{label}”': 'найдено рядом с «{label}»',
        'found with no label': 'найдено без подписи',
        'This document names {name} as the holder.': 'В этом документе владельцем указан {name}.',

        // Share and hand-off. A link that will not open and a card that did not
        // reach Quote each have several causes, and js/share.js separates them:
        // collapsing them sends four people out of five after the wrong problem.
        'That link is damaged and could not be read.': 'Эта ссылка повреждена и не читается.',
        'That link was made by a newer version of this app. Reload this page and open it again.': 'Эта ссылка создана более новой версией приложения. Обновите страницу и откройте её снова.',
        'That link carries a number this app never stores, so it was not opened.': 'В этой ссылке есть номер, который приложение не хранит, поэтому она не открыта.',
        'That link is far longer than anything this app writes, so it was not opened.': 'Эта ссылка намного длиннее всего, что создаёт приложение, поэтому она не открыта.',
        'That card is for {country}, not this one.': 'Эта карточка относится к юрисдикции {country}, а не к текущей.',
        'Link not verified': 'Ссылка не проверена',
        'This link is from an older version and carries no integrity check. Read every number back against your own document before you use it.': 'Эта ссылка сделана старой версией и не содержит проверки целостности. Перед использованием сверьте каждый номер со своим документом.',
        'This card is too large for a QR code. Share the link instead.': 'Эта карта слишком велика для QR-кода. Поделитесь ссылкой.',
        'This link is long — some chat apps will cut it. Send the image instead.': 'Ссылка длинная — некоторые мессенджеры её обрежут. Отправьте лучше изображение.',
        'This browser could not turn the card into an image.': 'Этот браузер не смог превратить карту в изображение.',
        'Your browser blocked the pop-up. Allow pop-ups for this page and try again.': 'Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этой страницы и повторите.',
        'Quote never answered — it may not have finished loading.': 'Quote не ответил — возможно, он ещё не загрузился.',
        'Quote opened but never confirmed it received the card.': 'Quote открылся, но не подтвердил, что получил карту.',
        'Quote declined the card.': 'Quote отклонил карту.',
        'That copy of Quote is too old for this card. Reload Quote and try again.': 'Та копия Quote слишком старая для этой карты. Обновите Quote и повторите.',
        'This page is too old for that copy of Quote. Reload this page and try again.': 'Эта страница слишком старая для той копии Quote. Обновите страницу и повторите.',
        'The hand-off could not start. Reload this page and try again.': 'Передача не началась. Обновите страницу и повторите.',
        'That tab was closed before the card arrived.': 'Вкладку закрыли до того, как карта дошла.',
        'The hand-off did not go through.': 'Передача не состоялась.',

        // Backup, restore and erase. js/store.js throws 'not-json', 'not-a-backup'
        // or 'shape' for a file it cannot use, and otherwise reports how many
        // cards it added, skipped and dropped.
        'Restore from a backup': 'Восстановить из резервной копии',
        'Choose a backup file, or paste one below.': 'Выберите файл резервной копии или вставьте её ниже.',
        'Replace everything on this device': 'Заменить всё на этом устройстве',
        '{n} cards restored': { one: 'Восстановлена {n} карта', few: 'Восстановлено {n} карты', many: 'Восстановлено {n} карт', other: 'Восстановлено карт: {n}' },
        '{n} were already here and were skipped': { one: '{n} карта уже была здесь и пропущена', few: '{n} карты уже были здесь и пропущены', many: '{n} карт уже были здесь и пропущены', other: 'Уже были здесь и пропущены: {n}' },
        '{n} could not be read and were dropped': { one: '{n} карту не удалось прочитать, она отброшена', few: '{n} карты не удалось прочитать, они отброшены', many: '{n} карт не удалось прочитать, они отброшены', other: 'Не удалось прочитать и отброшено: {n}' },
        'That backup was written by a newer version, so some fields may be missing.': 'Эта резервная копия создана более новой версией, поэтому некоторых полей может не быть.',
        'That file is not JSON.': 'Этот файл не в формате JSON.',
        'That file is not a Carino Fiscal backup.': 'Этот файл не является резервной копией Carino Fiscal.',
        'That backup holds no cards.': 'В этой резервной копии нет карт.',
        'Erase everything': 'Стереть всё',
        'This deletes every card in this browser. It cannot be undone, and there is no copy anywhere else.': 'Это удалит все карты в этом браузере. Отменить нельзя, и копии больше нигде нет.',
        'Everything on this device was erased.': 'Всё на этом устройстве стёрто.',

        // Offline readiness and updates. The service worker answers an
        // OFFLINE_STATUS message with what it has still to fetch, and a new
        // build waits for the page to offer the reload rather than taking it.
        'Ready to use offline': 'Готово к работе офлайн',
        'Still saving for offline use — {n} files to go.': 'Ещё сохраняется для работы офлайн — осталось файлов: {n}.',
        'A new version is ready.': 'Готова новая версия.',
        'Reload': 'Обновить',
        'Reloading will discard anything you are typing.': 'При обновлении всё, что вы сейчас печатаете, будет потеряно.',
    },
};

function currentFleetLang() { return (window.CarinoLang && window.CarinoLang.current) || 'en'; }

// Resolved on every lookup rather than latched by applyI18n. carino-navbar.js
// registers its 'carino:langchange' listener before this file is even parsed,
// so a cached locale would hand the navbar the *previous* language on every
// switch. carino-lang.js has already updated its own state by the time the
// event fires, so reading it live is the only ordering that cannot be wrong.
function activeLocale() {
    const code = currentFleetLang();
    return I18N[code] ? code : 'en';
}

function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function plural(forms, n) {
    if (typeof n === 'number') {
        const category = new Intl.PluralRules(activeLocale()).select(n);
        if (forms[category] != null) return forms[category];
    }
    return forms.other;
}

// js/app.js renders every field, badge and row through this. `vars` is
// optional: without it the raw translation comes back and the caller
// substitutes its own placeholders, which is what most call sites do. With it,
// a counted string picks its plural category from vars.n and every {name} is
// filled here — the substitution must not happen unasked, or a caller doing
// t('{n} cards on this device').replace('{n}', …) would find nothing to replace.
function t(key, vars) {
    // Several hundred call sites reach this through a lookup table, and a code
    // the table does not know hands over undefined. Printing "undefined" on a
    // card, or throwing where the caller has no catch, are both worse than
    // rendering nothing, so a key that is not a string resolves to the empty
    // string and the caller's `t(MAP[code] || 'a sentence')` is what supplies
    // the fallback.
    if (typeof key !== 'string') return '';
    const dict = I18N[activeLocale()];
    const canonical = SOURCE_ALIASES[key] || key;
    let value = (dict && dict[canonical]) != null ? dict[canonical] : canonical;
    if (value && typeof value === 'object') value = plural(value, vars && vars.n);
    // A plural object missing the category it was asked for falls back to the
    // English key rather than to undefined: English in a Japanese page is a
    // visible defect, and undefined is a silent one.
    if (typeof value !== 'string') value = canonical;
    return vars ? fill(value, vars) : value;
}

// Static markup. data-i18n: the original trimmed textContent is the key.
// data-i18n-ph does the same for a placeholder attribute, and data-i18n-attr
// names any other attributes to translate ("aria-label" or "aria-label,title").
// Every source string is cached on the first pass, so re-applying on a language
// change reads the original English rather than the last translation.
const ATTR_KEYS = new WeakMap();

function applyStaticI18n() {
    // Markup cannot pass variables of its own, so every string reached from
    // here is filled with the registry tallies and nothing else. A counted
    // string that means something different by {n} belongs in a t() call with
    // its own vars, and tools/check_i18n.py refuses it in the markup.
    const vars = COUNTS;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        if (!el.dataset.i18nKey) el.dataset.i18nKey = el.textContent.trim();
        el.textContent = t(el.dataset.i18nKey, vars);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
        if (!el.dataset.i18nPhKey) el.dataset.i18nPhKey = el.getAttribute('placeholder') || '';
        el.setAttribute('placeholder', t(el.dataset.i18nPhKey, vars));
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        let keys = ATTR_KEYS.get(el);
        if (!keys) {
            keys = {};
            el.dataset.i18nAttr.split(',').forEach((name) => {
                const attr = name.trim();
                if (attr) keys[attr] = el.getAttribute(attr) || '';
            });
            ATTR_KEYS.set(el, keys);
        }
        Object.keys(keys).forEach((attr) => el.setAttribute(attr, t(keys[attr], vars)));
    });
}

// The tab title and the meta description are the app's first impression in a
// locale and neither can carry a data- attribute usefully, so their English
// text is latched from index.html on the first pass instead.
let titleKey = '';
let descriptionKey = '';

function applyHeadI18n() {
    if (document.title) {
        if (!titleKey) titleKey = document.title.trim();
        document.title = t(titleKey);
    }
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
        if (!descriptionKey) descriptionKey = meta.getAttribute('content') || '';
        meta.setAttribute('content', t(descriptionKey));
    }
}

function applyI18n() {
    document.documentElement.dir = DIR[activeLocale()] || 'ltr';
    applyHeadI18n();
    applyStaticI18n();
    // Re-render the JS-generated surfaces. app.js may still be fetching the
    // registry on first paint, hence the guard.
    if (window.FISCAL && typeof window.FISCAL.render === 'function') window.FISCAL.render();
}

// The tallies are registry facts, so the registry is what supplies them:
// js/app.js hands over the country list the instant its fetch resolves and the
// coverage sentence re-renders in whatever language is showing. Counting here
// rather than in the caller keeps the tier arithmetic beside the strings that
// read it, and leaves app.js one line that cannot compute a different total
// from the one it puts in #jurisdictionTotal.
function setCounts(countries) {
    COUNTS.n = countries.length;
    COUNTS.t1 = countries.filter((c) => c.tier === 1).length;
    COUNTS.t2 = countries.filter((c) => c.tier === 2).length;
    applyI18n();
}

// window.t is the fleet's lookup and carino-navbar.js expects it by that name.
// The rest is this app's seam: anything that changes what a string renders as
// has to be able to ask for a re-apply, or the change lands on the next
// language switch and nowhere sooner.
window.t = t;
window.CarinoI18n = { t: t, apply: applyI18n, setCounts: setCounts };

document.addEventListener('DOMContentLoaded', applyI18n);
window.addEventListener('carino:langchange', applyI18n);
