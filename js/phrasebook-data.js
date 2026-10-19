/* Frasario: fraseologia standard ICAO (in inglese) con spiegazione in italiano o inglese.
   I testi tradotti sono coppie [italiano, inglese]. Esempi con nominativo "Alitalia 123";
   procedure e frequenze sono di esempio. */
(function (root) {
  'use strict';

  const SECTIONS = [
    {
      title: ['Autorizzazione (Clearance Delivery)', 'Clearance (Clearance Delivery)'],
      items: [
        { when: ['Chiedere l\'autorizzazione IFR', 'Requesting IFR clearance'], pilot: 'Roma Delivery, Alitalia 123, stand 12, information Bravo, request IFR clearance to Milano Malpensa', note: ['Prima ascolta l\'ATIS e annota la lettera (qui "Bravo").', 'Listen to the ATIS first and note its letter (here "Bravo").'] },
        { when: ['Ricevi l\'autorizzazione', 'Receiving the clearance'], atc: 'Alitalia 123, cleared to Milano Malpensa via BOLLA 5A departure, climb initially 6000 feet, squawk 4521', pilot: 'Cleared to Milano Malpensa, BOLLA 5A departure, climb initially 6000 feet, squawk 4521, Alitalia 123', note: ['Ripeti tutto: destinazione, SID, quota iniziale e squawk.', 'Read back everything: destination, SID, initial altitude and squawk.'] },
        { when: ['Readback corretto, passa al Ground', 'Readback correct, over to Ground'], atc: 'Alitalia 123, readback correct, contact Ground 121.8', pilot: 'Ground 121.8, Alitalia 123' },
        { when: ['Nuovo ATIS', 'New ATIS'], atc: 'Alitalia 123, information Charlie is now current, QNH 1015', pilot: 'Information Charlie, QNH 1015, Alitalia 123' },
      ],
    },
    {
      title: ['A terra (Ground)', 'On the ground (Ground)'],
      items: [
        { when: ['Chiedere push e accensione', 'Requesting push and start'], pilot: 'Roma Ground, Alitalia 123, stand 12, request pushback and startup' },
        { when: ['Push approvato', 'Push approved'], atc: 'Alitalia 123, push and start approved, facing south', pilot: 'Push and start approved, facing south, Alitalia 123' },
        { when: ['Chiedere il rullaggio', 'Requesting taxi'], pilot: 'Roma Ground, Alitalia 123, request taxi' },
        { when: ['Istruzioni di rullaggio', 'Taxi instructions'], atc: 'Alitalia 123, taxi to holding point runway 16L via Alpha, Bravo', pilot: 'Taxi to holding point runway 16L via Alpha, Bravo, Alitalia 123' },
        { when: ['Fermarsi prima di una pista', 'Holding short of a runway'], atc: 'Alitalia 123, hold short of runway 16R', pilot: 'Holding short runway 16R, Alitalia 123', note: ['Le istruzioni che riguardano le piste vanno SEMPRE ripetute.', 'Runway instructions must ALWAYS be read back.'] },
        { when: ['Attraversare una pista', 'Crossing a runway'], atc: 'Alitalia 123, cross runway 16R', pilot: 'Crossing runway 16R, Alitalia 123' },
        { when: ['Dare precedenza', 'Giving way'], atc: 'Alitalia 123, give way to the Lufthansa A320 passing left to right', pilot: 'Giving way to the Lufthansa A320, Alitalia 123' },
        { when: ['Fermarsi subito', 'Stopping immediately'], atc: 'Alitalia 123, hold position', pilot: 'Holding position, Alitalia 123' },
      ],
    },
    {
      title: ['Torre (Tower)', 'Tower'],
      items: [
        { when: ['Pronto al decollo', 'Ready for departure'], pilot: 'Roma Tower, Alitalia 123, holding point runway 16L, ready for departure' },
        { when: ['Allinearsi e attendere', 'Line up and wait'], atc: 'Alitalia 123, runway 16L, line up and wait', pilot: 'Runway 16L, line up and wait, Alitalia 123' },
        { when: ['Autorizzazione condizionata', 'Conditional clearance'], atc: 'Alitalia 123, behind the landing A320, line up and wait runway 16L, behind', pilot: 'Behind the landing A320, line up and wait runway 16L, behind, Alitalia 123', note: ['Ripeti anche la condizione ("behind…"), all\'inizio e alla fine.', 'Read back the condition too ("behind…"), at the start and at the end.'] },
        { when: ['Decollo autorizzato', 'Cleared for takeoff'], atc: 'Alitalia 123, wind 160 degrees 5 knots, runway 16L, cleared for takeoff', pilot: 'Runway 16L, cleared for takeoff, Alitalia 123', note: ['Il vento non va ripetuto.', 'The wind is not read back.'] },
        { when: ['Atterraggio autorizzato', 'Cleared to land'], atc: 'Alitalia 123, runway 16L, cleared to land, wind 170 degrees 8 knots', pilot: 'Runway 16L, cleared to land, Alitalia 123' },
        { when: ['Riattaccata', 'Go-around'], atc: 'Alitalia 123, go around', pilot: 'Going around, Alitalia 123' },
        { when: ['Liberare la pista', 'Vacating the runway'], atc: 'Alitalia 123, vacate left via Bravo, contact Ground 121.8', pilot: 'Vacate left via Bravo, Ground 121.8, Alitalia 123' },
      ],
    },
    {
      title: ['Partenza e crociera', 'Departure and cruise'],
      items: [
        { when: ['Primo contatto dopo il decollo', 'First contact after takeoff'], pilot: 'Roma Radar, Alitalia 123, passing 2500 feet, climbing 6000 feet' },
        { when: ['Contatto radar e salita', 'Radar contact and climb'], atc: 'Alitalia 123, radar contact, climb flight level 120', pilot: 'Climb flight level 120, Alitalia 123', note: ['"Radar contact" non va ripetuto.', '"Radar contact" is not read back.'] },
        { when: ['Diretto a un punto', 'Direct to a waypoint'], atc: 'Alitalia 123, proceed direct TORLI', pilot: 'Direct TORLI, Alitalia 123' },
        { when: ['Cambio frequenza', 'Frequency change'], atc: 'Alitalia 123, contact Roma Control 128.25', pilot: 'Roma Control 128.25, Alitalia 123' },
        { when: ['Chiedere un livello', 'Requesting a level'], pilot: 'Roma Control, Alitalia 123, request flight level 380' },
        { when: ['Chiedere un diretto', 'Requesting a direct'], pilot: 'Roma Control, Alitalia 123, request direct TORLI' },
        { when: ['Chiedere la discesa', 'Requesting descent'], pilot: 'Alitalia 123, request descent' },
        { when: ['Non puoi eseguire', 'You can\'t comply'], atc: 'Alitalia 123, climb flight level 410', pilot: 'Unable, Alitalia 123', note: ['"Unable" = non posso. Se puoi, spiega perché o proponi un\'alternativa.', '"Unable" = I can\'t. If you can, say why or suggest an alternative.'] },
      ],
    },
    {
      title: ['Arrivo e avvicinamento', 'Arrival and approach'],
      items: [
        { when: ['Primo contatto con l\'avvicinamento', 'First contact with approach'], pilot: 'Roma Approach, Alitalia 123, descending flight level 100, information Kilo' },
        { when: ['Discesa con QNH', 'Descent with QNH'], atc: 'Alitalia 123, descend to altitude 4000 feet, QNH 1013', pilot: 'Descend 4000 feet, QNH 1013, Alitalia 123', note: ['Sotto il livello di transizione si usa la quota in piedi con il QNH.', 'Below the transition level you use altitude in feet with the QNH.'] },
        { when: ['Vettoramento', 'Vectors'], atc: 'Alitalia 123, turn left heading 250', pilot: 'Left heading 250, Alitalia 123' },
        { when: ['Autorizzazione ILS', 'ILS clearance'], atc: 'Alitalia 123, cleared ILS approach runway 16L, report established', pilot: 'Cleared ILS approach runway 16L, wilco, Alitalia 123', note: ['"Wilco" = eseguirò (per la richiesta di riportare).', '"Wilco" = will comply (for the request to report).'] },
        { when: ['Riduzione velocità', 'Speed reduction'], atc: 'Alitalia 123, reduce speed 180 knots', pilot: 'Speed 180 knots, Alitalia 123' },
        { when: ['Stabilizzato', 'Established'], pilot: 'Alitalia 123, established ILS runway 16L' },
      ],
    },
    {
      title: ['Situazioni particolari', 'Special situations'],
      items: [
        { when: ['Non hai capito', 'You didn\'t understand'], pilot: 'Say again, Alitalia 123', note: ['Meglio chiedere che indovinare. Puoi anche dire "say again frequency" o "say again squawk".', 'Better to ask than to guess. You can also say "say again frequency" or "say again squawk".'] },
        { when: ['L\'ATC ti dice di aspettare', 'ATC tells you to wait'], atc: 'Alitalia 123, standby', pilot: ['(non rispondere, aspetta che ti richiami)', '(don\'t reply, wait to be called back)'], note: ['"Standby" = aspetta, ti richiamo io.', '"Standby" = wait, I\'ll call you back.'] },
        { when: ['Prova radio', 'Radio check'], pilot: 'Roma Radar, Alitalia 123, radio check 125.5', note: ['Risposta tipica: "readability 5" (ti sento perfettamente).', 'Typical answer: "readability 5" (I hear you perfectly).'] },
        { when: ['Emergenza (MAYDAY)', 'Emergency (MAYDAY)'], pilot: 'Mayday mayday mayday, Roma Radar, Alitalia 123, engine failure, descending flight level 100, request vectors to the nearest airport', note: ['Su VATSIM simula emergenze solo se il controllore è d\'accordo. Squawk 7700.', 'On VATSIM only simulate emergencies if the controller agrees. Squawk 7700.'] },
        { when: ['Urgenza (PAN PAN)', 'Urgency (PAN PAN)'], pilot: 'Pan pan, pan pan, pan pan, Roma Radar, Alitalia 123, passenger medical problem, request priority landing' },
        { when: ['Avaria radio', 'Radio failure'], pilot: ['(squawk 7600 e segui le procedure di perdita contatto radio)', '(squawk 7600 and follow the lost-communication procedures)'], note: ['Non usare mai 7500 (dirottamento) su VATSIM.', 'Never use 7500 (hijack) on VATSIM.'] },
        { when: ['Nessun ATC online', 'No ATC online'], pilot: ['(messaggio di testo su UNICOM 122.800) Fiumicino traffic, Alitalia 123, taxiing to runway 16L', '(text message on UNICOM 122.800) Fiumicino traffic, Alitalia 123, taxiing to runway 16L'], note: ['Su VATSIM l\'UNICOM 122.800 si usa via testo per annunciare le proprie intenzioni.', 'On VATSIM, UNICOM 122.800 is used by text to announce your intentions.'] },
      ],
    },
  ];

  const GLOSSARY = [
    ['Roger', ['Ho ricevuto il messaggio (non significa "eseguo").', 'I have received your message (it does not mean "I will comply").']],
    ['Wilco', ['Ho capito ed eseguirò.', 'Understood, will comply.']],
    ['Affirm', ['Sì.', 'Yes.']],
    ['Negative', ['No.', 'No.']],
    ['Say again', ['Ripeti, non ho capito.', 'Repeat, I didn\'t understand.']],
    ['Standby', ['Aspetta, ti richiamo.', 'Wait, I\'ll call you back.']],
    ['Unable', ['Non posso eseguire.', 'I cannot comply.']],
    ['Readback', ['Ripetizione delle istruzioni ricevute, per confermare di averle capite.', 'Repeating the instructions received, to confirm you understood them.']],
    ['Squawk', ['Codice di 4 cifre (da 0 a 7) da impostare sul transponder.', '4-digit code (digits 0 to 7) to set on the transponder.']],
    ['Ident', ['Premi il tasto IDENT del transponder.', 'Press the transponder IDENT button.']],
    ['QNH', ['Pressione da impostare sull\'altimetro per leggere la quota sul livello del mare.', 'Pressure set on the altimeter to read altitude above sea level.']],
    ['Flight level (FL)', ['Livello di volo in centinaia di piedi con altimetro a 1013 hPa (FL80 = 8000 ft).', 'Flight level in hundreds of feet with the altimeter at 1013 hPa (FL80 = 8000 ft).']],
    [['Livello / quota di transizione', 'Transition level / altitude'], ['Dove si passa da quota (QNH) a livello di volo (1013) e viceversa.', 'Where you switch from altitude (QNH) to flight level (1013) and back.']],
    ['ATIS', ['Bollettino registrato con meteo, pista in uso e QNH; ogni versione ha una lettera.', 'Recorded broadcast with weather, runway in use and QNH; each version has a letter.']],
    ['SID', ['Procedura standard di partenza strumentale.', 'Standard Instrument Departure.']],
    ['STAR', ['Procedura standard di arrivo strumentale.', 'Standard Terminal Arrival Route.']],
    ['Holding point', ['Punto attesa prima di entrare in pista.', 'Where you wait before entering the runway.']],
    ['Line up and wait', ['Allineati in pista e aspetta (NON decollare).', 'Line up on the runway and wait (do NOT take off).']],
    ['METAR', ['Bollettino meteo dell\'aeroporto, aggiornato ogni 30 minuti circa.', 'Airport weather report, updated about every 30 minutes.']],
    ['CAVOK', ['Visibilità 10 km o più e nessuna nube significativa.', 'Visibility 10 km or more and no significant cloud.']],
    ['UNICOM', ['Frequenza 122.800 usata su VATSIM quando non c\'è controllo.', 'Frequency 122.800 used on VATSIM when there is no ATC.']],
  ];

  root.PhrasebookData = { SECTIONS, GLOSSARY };
})(this);
