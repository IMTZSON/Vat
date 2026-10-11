/* Frasario: fraseologia standard ICAO con spiegazione in italiano.
   Esempi con nominativo "Alitalia 123"; procedure e frequenze sono di esempio. */
(function (root) {
  'use strict';

  const SECTIONS = [
    {
      title: 'Autorizzazione (Clearance Delivery)',
      items: [
        { when: 'Chiedere l\'autorizzazione IFR', pilot: 'Roma Delivery, Alitalia 123, stand 12, information Bravo, request IFR clearance to Milano Malpensa', note: 'Prima ascolta l\'ATIS e annota la lettera (qui "Bravo").' },
        { when: 'Ricevi l\'autorizzazione', atc: 'Alitalia 123, cleared to Milano Malpensa via BOLLA 5A departure, climb initially 6000 feet, squawk 4521', pilot: 'Cleared to Milano Malpensa, BOLLA 5A departure, climb initially 6000 feet, squawk 4521, Alitalia 123', note: 'Ripeti tutto: destinazione, SID, quota iniziale e squawk.' },
        { when: 'Readback corretto, passa al Ground', atc: 'Alitalia 123, readback correct, contact Ground 121.8', pilot: 'Ground 121.8, Alitalia 123' },
        { when: 'Nuovo ATIS', atc: 'Alitalia 123, information Charlie is now current, QNH 1015', pilot: 'Information Charlie, QNH 1015, Alitalia 123' },
      ],
    },
    {
      title: 'A terra (Ground)',
      items: [
        { when: 'Chiedere push e accensione', pilot: 'Roma Ground, Alitalia 123, stand 12, request pushback and startup' },
        { when: 'Push approvato', atc: 'Alitalia 123, push and start approved, facing south', pilot: 'Push and start approved, facing south, Alitalia 123' },
        { when: 'Chiedere il rullaggio', pilot: 'Roma Ground, Alitalia 123, request taxi' },
        { when: 'Istruzioni di rullaggio', atc: 'Alitalia 123, taxi to holding point runway 16L via Alpha, Bravo', pilot: 'Taxi to holding point runway 16L via Alpha, Bravo, Alitalia 123' },
        { when: 'Fermarsi prima di una pista', atc: 'Alitalia 123, hold short of runway 16R', pilot: 'Holding short runway 16R, Alitalia 123', note: 'Le istruzioni che riguardano le piste vanno SEMPRE ripetute.' },
        { when: 'Attraversare una pista', atc: 'Alitalia 123, cross runway 16R', pilot: 'Crossing runway 16R, Alitalia 123' },
        { when: 'Dare precedenza', atc: 'Alitalia 123, give way to the Lufthansa A320 passing left to right', pilot: 'Giving way to the Lufthansa A320, Alitalia 123' },
        { when: 'Fermarsi subito', atc: 'Alitalia 123, hold position', pilot: 'Holding position, Alitalia 123' },
      ],
    },
    {
      title: 'Torre (Tower)',
      items: [
        { when: 'Pronto al decollo', pilot: 'Roma Tower, Alitalia 123, holding point runway 16L, ready for departure' },
        { when: 'Allinearsi e attendere', atc: 'Alitalia 123, runway 16L, line up and wait', pilot: 'Runway 16L, line up and wait, Alitalia 123' },
        { when: 'Autorizzazione condizionata', atc: 'Alitalia 123, behind the landing A320, line up and wait runway 16L, behind', pilot: 'Behind the landing A320, line up and wait runway 16L, behind, Alitalia 123', note: 'Ripeti anche la condizione ("behind…"), all\'inizio e alla fine.' },
        { when: 'Decollo autorizzato', atc: 'Alitalia 123, wind 160 degrees 5 knots, runway 16L, cleared for takeoff', pilot: 'Runway 16L, cleared for takeoff, Alitalia 123', note: 'Il vento non va ripetuto.' },
        { when: 'Atterraggio autorizzato', atc: 'Alitalia 123, runway 16L, cleared to land, wind 170 degrees 8 knots', pilot: 'Runway 16L, cleared to land, Alitalia 123' },
        { when: 'Riattaccata', atc: 'Alitalia 123, go around', pilot: 'Going around, Alitalia 123' },
        { when: 'Liberare la pista', atc: 'Alitalia 123, vacate left via Bravo, contact Ground 121.8', pilot: 'Vacate left via Bravo, Ground 121.8, Alitalia 123' },
      ],
    },
    {
      title: 'Partenza e crociera',
      items: [
        { when: 'Primo contatto dopo il decollo', pilot: 'Roma Radar, Alitalia 123, passing 2500 feet, climbing 6000 feet' },
        { when: 'Contatto radar e salita', atc: 'Alitalia 123, radar contact, climb flight level 120', pilot: 'Climb flight level 120, Alitalia 123', note: '"Radar contact" non va ripetuto.' },
        { when: 'Diretto a un punto', atc: 'Alitalia 123, proceed direct TORLI', pilot: 'Direct TORLI, Alitalia 123' },
        { when: 'Cambio frequenza', atc: 'Alitalia 123, contact Roma Control 128.25', pilot: 'Roma Control 128.25, Alitalia 123' },
        { when: 'Chiedere un livello', pilot: 'Roma Control, Alitalia 123, request flight level 380' },
        { when: 'Chiedere un diretto', pilot: 'Roma Control, Alitalia 123, request direct TORLI' },
        { when: 'Chiedere la discesa', pilot: 'Alitalia 123, request descent' },
        { when: 'Non puoi eseguire', atc: 'Alitalia 123, climb flight level 410', pilot: 'Unable, Alitalia 123', note: '"Unable" = non posso. Se puoi, spiega perché o proponi un\'alternativa.' },
      ],
    },
    {
      title: 'Arrivo e avvicinamento',
      items: [
        { when: 'Primo contatto con l\'avvicinamento', pilot: 'Roma Approach, Alitalia 123, descending flight level 100, information Kilo' },
        { when: 'Discesa con QNH', atc: 'Alitalia 123, descend to altitude 4000 feet, QNH 1013', pilot: 'Descend 4000 feet, QNH 1013, Alitalia 123', note: 'Sotto il livello di transizione si usa la quota in piedi con il QNH.' },
        { when: 'Vettoramento', atc: 'Alitalia 123, turn left heading 250', pilot: 'Left heading 250, Alitalia 123' },
        { when: 'Autorizzazione ILS', atc: 'Alitalia 123, cleared ILS approach runway 16L, report established', pilot: 'Cleared ILS approach runway 16L, wilco, Alitalia 123', note: '"Wilco" = eseguirò (per la richiesta di riportare).' },
        { when: 'Riduzione velocità', atc: 'Alitalia 123, reduce speed 180 knots', pilot: 'Speed 180 knots, Alitalia 123' },
        { when: 'Stabilizzato', pilot: 'Alitalia 123, established ILS runway 16L' },
      ],
    },
    {
      title: 'Situazioni particolari',
      items: [
        { when: 'Non hai capito', pilot: 'Say again, Alitalia 123', note: 'Meglio chiedere che indovinare. Puoi anche dire "say again frequency" o "say again squawk".' },
        { when: 'L\'ATC ti dice di aspettare', atc: 'Alitalia 123, standby', pilot: '(non rispondere, aspetta che ti richiami)', note: '"Standby" = aspetta, ti richiamo io.' },
        { when: 'Prova radio', pilot: 'Roma Radar, Alitalia 123, radio check 125.5', note: 'Risposta tipica: "readability 5" (ti sento perfettamente).' },
        { when: 'Emergenza (MAYDAY)', pilot: 'Mayday mayday mayday, Roma Radar, Alitalia 123, engine failure, descending flight level 100, request vectors to the nearest airport', note: 'Su VATSIM simula emergenze solo se il controllore è d\'accordo. Squawk 7700.' },
        { when: 'Urgenza (PAN PAN)', pilot: 'Pan pan, pan pan, pan pan, Roma Radar, Alitalia 123, passenger medical problem, request priority landing' },
        { when: 'Avaria radio', pilot: '(squawk 7600 e segui le procedure di perdita contatto radio)', note: 'Non usare mai 7500 (dirottamento) su VATSIM.' },
        { when: 'Nessun ATC online', pilot: '(messaggio di testo su UNICOM 122.800) Fiumicino traffic, Alitalia 123, taxiing to runway 16L', note: 'Su VATSIM l\'UNICOM 122.800 si usa via testo per annunciare le proprie intenzioni.' },
      ],
    },
  ];

  const GLOSSARY = [
    ['Roger', 'Ho ricevuto il messaggio (non significa "eseguo").'],
    ['Wilco', 'Ho capito ed eseguirò.'],
    ['Affirm', 'Sì.'],
    ['Negative', 'No.'],
    ['Say again', 'Ripeti, non ho capito.'],
    ['Standby', 'Aspetta, ti richiamo.'],
    ['Unable', 'Non posso eseguire.'],
    ['Readback', 'Ripetizione delle istruzioni ricevute, per confermare di averle capite.'],
    ['Squawk', 'Codice di 4 cifre (da 0 a 7) da impostare sul transponder.'],
    ['Ident', 'Premi il tasto IDENT del transponder.'],
    ['QNH', 'Pressione da impostare sull\'altimetro per leggere la quota sul livello del mare.'],
    ['Flight level (FL)', 'Livello di volo in centinaia di piedi con altimetro a 1013 hPa (FL80 = 8000 ft).'],
    ['Livello / quota di transizione', 'Dove si passa da quota (QNH) a livello di volo (1013) e viceversa.'],
    ['ATIS', 'Bollettino registrato con meteo, pista in uso e QNH; ogni versione ha una lettera.'],
    ['SID', 'Procedura standard di partenza strumentale.'],
    ['STAR', 'Procedura standard di arrivo strumentale.'],
    ['Holding point', 'Punto attesa prima di entrare in pista.'],
    ['Line up and wait', 'Allineati in pista e aspetta (NON decollare).'],
    ['METAR', 'Bollettino meteo dell\'aeroporto, aggiornato ogni 30 minuti circa.'],
    ['CAVOK', 'Visibilità 10 km o più e nessuna nube significativa.'],
    ['UNICOM', 'Frequenza 122.800 usata su VATSIM quando non c\'è controllo.'],
  ];

  root.PhrasebookData = { SECTIONS, GLOSSARY };
})(this);
