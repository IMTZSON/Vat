/* Checklist normali semplificate per simulazione (A320 family e Boeing 737).
   Testo generico scritto per l'app: NON sostituisce le checklist ufficiali dell'aereo che usi nel simulatore.
   Ogni voce: [elemento, stato atteso]. phase: fase del tracking in cui la checklist viene suggerita. */
(function (root) {
  'use strict';

  const CHECKLISTS = {
    A320: [
      { id: 'prep', title: 'Preparazione cockpit', phase: 'parked', items: [
        ['Batterie / alimentazione esterna', 'ON'], ['ADIRS', 'NAV'], ['Carburante a bordo', 'CONTROLLATO vs OFP'],
        ['Piano di volo nell\'MCDU', 'INSERITO'], ['Prestazioni di decollo', 'CALCOLATE'], ['Altimetri', 'QNH IMPOSTATO'],
        ['Segnali cinture / fumo', 'ON / AUTO'], ['Freno di parcheggio', 'TIRATO'] ] },
      { id: 'beforeStart', title: 'Prima dell\'avvio', phase: 'parked', items: [
        ['Autorizzazione ATC', 'RICEVUTA'], ['Porte', 'CHIUSE'], ['Beacon', 'ON'], ['Transponder', 'SQUAWK IMPOSTATO'],
        ['Leve di spinta', 'IDLE'], ['Freno di parcheggio', 'TIRATO'], ['Briefing di partenza', 'COMPLETATO'] ] },
      { id: 'afterStart', title: 'Dopo l\'avvio', phase: 'taxi-out', items: [
        ['APU bleed', 'OFF'], ['Anti-ghiaccio motori', 'SE NECESSARIO'], ['Flap', 'IMPOSTATI PER IL DECOLLO'], ['Pitch trim', 'IMPOSTATO'],
        ['Spoiler a terra', 'ARMATI'], ['Comandi di volo', 'CONTROLLATI'], ['APU', 'OFF'] ] },
      { id: 'beforeTakeoff', title: 'Prima del decollo', phase: 'taxi-out', items: [
        ['Configurazione di decollo', 'TEST OK'], ['Strumenti di volo', 'CONTROLLATI'], ['Cabina', 'PRONTA'], ['TCAS', 'TA/RA'],
        ['Luci di atterraggio e strobo', 'ON'], ['Pista di decollo', 'CONFERMATA'] ] },
      { id: 'afterTakeoff', title: 'Dopo il decollo', phase: 'climb', items: [
        ['Carrello', 'SU'], ['Flap', 'RETRATTI'], ['Packs', 'ON'], ['Altimetri', 'STD (sopra quota di transizione)'],
        ['Luci di atterraggio', 'OFF (sopra FL100)'] ] },
      { id: 'cruise', title: 'Crociera', phase: 'cruise', items: [
        ['Carburante', 'CONTROLLATO vs OFP'], ['Stato ECAM', 'CONTROLLATO'], ['Meteo destinazione / ATIS', 'ASCOLTATO'] ] },
      { id: 'descent', title: 'Preparazione discesa', phase: 'descent', items: [
        ['Prestazioni di atterraggio', 'CALCOLATE'], ['Arrivo e avvicinamento nell\'MCDU', 'INSERITI'], ['Minimi', 'IMPOSTATI'],
        ['Autobrake', 'IMPOSTATO'], ['Briefing di avvicinamento', 'COMPLETATO'] ] },
      { id: 'approach', title: 'Avvicinamento', phase: 'approach', items: [
        ['Altimetri', 'QNH IMPOSTATO'], ['Segnali cinture', 'ON'], ['Minimi', 'CONTROLLATI'], ['Luci di atterraggio', 'ON (sotto FL100)'] ] },
      { id: 'landing', title: 'Atterraggio', phase: 'approach', items: [
        ['Cabina', 'PRONTA'], ['Carrello', 'GIÙ, 3 VERDI'], ['Spoiler', 'ARMATI'], ['Flap', 'CONFIGURAZIONE DI ATTERRAGGIO'],
        ['Memo di atterraggio', 'NESSUNA VOCE BLU'] ] },
      { id: 'afterLanding', title: 'Dopo l\'atterraggio', phase: 'landed', items: [
        ['Spoiler', 'DISARMATI'], ['Flap', 'RETRATTI'], ['Strobo e luci di atterraggio', 'OFF'], ['Radar meteo', 'OFF'], ['APU', 'AVVIATA'] ] },
      { id: 'parking', title: 'Parcheggio', phase: 'arrived', items: [
        ['Freno di parcheggio', 'TIRATO'], ['Motori', 'SPENTI'], ['Beacon', 'OFF'], ['Segnali cinture', 'OFF'], ['Pompe carburante', 'OFF'] ] },
    ],
    B737: [
      { id: 'prep', title: 'Preflight', phase: 'parked', items: [
        ['Ossigeno', 'TESTATO, 100%'], ['IRS', 'NAV'], ['Riscaldamento finestrini', 'ON'], ['Pressurizzazione', 'AUTO'],
        ['CDU (rotta e prestazioni)', 'COMPLETATO'], ['Altimetri', 'QNH IMPOSTATO'], ['Freno di parcheggio', 'TIRATO'], ['Leve start motori', 'CUTOFF'] ] },
      { id: 'beforeStart', title: 'Before start', phase: 'parked', items: [
        ['Porta cockpit', 'CHIUSA E BLOCCATA'], ['Carburante', 'QUANTITÀ OK, POMPE ON'], ['Segnali passeggeri', 'IMPOSTATI'],
        ['MCP (V2, HDG, ALT)', 'IMPOSTATO'], ['Velocità di decollo', 'V1 VR V2 IMPOSTATE'], ['Trim timone e alettoni', 'LIBERI E A 0'],
        ['Briefing di rullaggio e decollo', 'COMPLETATO'], ['Luce anticollisione', 'ON'] ] },
      { id: 'afterStart', title: 'Before taxi', phase: 'taxi-out', items: [
        ['Generatori', 'ON'], ['Riscaldamento sonde', 'ON'], ['Anti-ghiaccio', 'SE NECESSARIO'], ['Isolation valve', 'AUTO'],
        ['Autobrake', 'RTO'], ['Comandi di volo', 'CONTROLLATI'], ['Area attorno all\'aereo', 'LIBERA'] ] },
      { id: 'beforeTakeoff', title: 'Before takeoff', phase: 'taxi-out', items: [
        ['Flap', 'IMPOSTATI, LUCE VERDE'], ['Trim stabilizzatore', 'IMPOSTATO'], ['Briefing di decollo', 'RIVISTO'],
        ['Transponder', 'TA/RA'], ['Luci di atterraggio', 'ON'] ] },
      { id: 'afterTakeoff', title: 'After takeoff', phase: 'climb', items: [
        ['Bleed motori', 'ON'], ['Packs', 'AUTO'], ['Carrello', 'SU E OFF'], ['Flap', 'SU, NESSUNA LUCE'], ['Altimetri', 'STD (alla transizione)'] ] },
      { id: 'cruise', title: 'Crociera', phase: 'cruise', items: [
        ['Carburante', 'CONTROLLATO vs OFP'], ['Meteo destinazione / ATIS', 'ASCOLTATO'] ] },
      { id: 'descent', title: 'Descent', phase: 'descent', items: [
        ['Pressurizzazione', 'QUOTA DI ATTERRAGGIO IMPOSTATA'], ['Recall', 'CONTROLLATO'], ['Autobrake', 'IMPOSTATO'],
        ['Dati di atterraggio (VREF, minimi)', 'IMPOSTATI'], ['Briefing di avvicinamento', 'COMPLETATO'] ] },
      { id: 'approach', title: 'Approach', phase: 'approach', items: [
        ['Altimetri', 'QNH IMPOSTATO'], ['Luci di atterraggio', 'ON (sotto FL100)'] ] },
      { id: 'landing', title: 'Landing', phase: 'approach', items: [
        ['Engine start switches', 'CONT'], ['Speedbrake', 'ARMATO'], ['Carrello', 'GIÙ'], ['Flap', 'IMPOSTATI, LUCE VERDE'] ] },
      { id: 'afterLanding', title: 'After landing', phase: 'landed', items: [
        ['Speedbrake', 'GIÙ'], ['Flap', 'SU'], ['Riscaldamento sonde', 'OFF'], ['Strobo e luci di atterraggio', 'OFF'], ['APU', 'AVVIATA'] ] },
      { id: 'parking', title: 'Shutdown', phase: 'arrived', items: [
        ['Freno di parcheggio', 'TIRATO'], ['Pompe carburante', 'OFF'], ['Leve start motori', 'CUTOFF'], ['Segnali cinture', 'OFF'], ['Luce anticollisione', 'OFF'] ] },
    ],
  };

  root.ChecklistsData = { CHECKLISTS };
})(this);
