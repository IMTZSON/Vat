/* Checklist normali semplificate per simulazione (A320 family e Boeing 737).
   Testo generico scritto per l'app: NON sostituisce le checklist ufficiali dell'aereo che usi nel simulatore.
   Ogni voce: [elemento, stato atteso]; i testi tradotti sono coppie [italiano, inglese].
   phase: fase del tracking in cui la checklist viene suggerita. */
(function (root) {
  'use strict';

  const CHECKLISTS = {
    A320: [
      { id: 'prep', title: ['Preparazione cockpit', 'Cockpit preparation'], phase: 'parked', items: [
        [['Batterie / alimentazione esterna', 'Batteries / external power'], 'ON'], ['ADIRS', 'NAV'], [['Carburante a bordo', 'Fuel on board'], ['CONTROLLATO vs OFP', 'CHECKED vs OFP']],
        [['Piano di volo nell\'MCDU', 'Flight plan in the MCDU'], ['INSERITO', 'ENTERED']], [['Prestazioni di decollo', 'Takeoff performance'], ['CALCOLATE', 'COMPUTED']], [['Altimetri', 'Altimeters'], ['QNH IMPOSTATO', 'QNH SET']],
        [['Segnali cinture / fumo', 'Seat belts / no smoking'], 'ON / AUTO'], [['Freno di parcheggio', 'Parking brake'], ['TIRATO', 'SET']] ] },
      { id: 'beforeStart', title: ['Prima dell\'avvio', 'Before start'], phase: 'parked', items: [
        [['Autorizzazione ATC', 'ATC clearance'], ['RICEVUTA', 'RECEIVED']], [['Porte', 'Doors'], ['CHIUSE', 'CLOSED']], ['Beacon', 'ON'], ['Transponder', ['SQUAWK IMPOSTATO', 'SQUAWK SET']],
        [['Leve di spinta', 'Thrust levers'], 'IDLE'], [['Freno di parcheggio', 'Parking brake'], ['TIRATO', 'SET']], [['Briefing di partenza', 'Departure briefing'], ['COMPLETATO', 'COMPLETED']] ] },
      { id: 'afterStart', title: ['Dopo l\'avvio', 'After start'], phase: 'taxi-out', items: [
        ['APU bleed', 'OFF'], [['Anti-ghiaccio motori', 'Engine anti-ice'], ['SE NECESSARIO', 'AS RQRD']], ['Flaps', ['IMPOSTATI PER IL DECOLLO', 'SET FOR TAKEOFF']], ['Pitch trim', ['IMPOSTATO', 'SET']],
        [['Spoiler a terra', 'Ground spoilers'], ['ARMATI', 'ARMED']], [['Comandi di volo', 'Flight controls'], ['CONTROLLATI', 'CHECKED']], ['APU', 'OFF'] ] },
      { id: 'beforeTakeoff', title: ['Prima del decollo', 'Before takeoff'], phase: 'taxi-out', items: [
        [['Configurazione di decollo', 'Takeoff config'], 'TEST OK'], [['Strumenti di volo', 'Flight instruments'], ['CONTROLLATI', 'CHECKED']], [['Cabina', 'Cabin'], ['PRONTA', 'READY']], ['TCAS', 'TA/RA'],
        [['Luci di atterraggio e strobo', 'Landing lights and strobes'], 'ON'], [['Pista di decollo', 'Takeoff runway'], ['CONFERMATA', 'CONFIRMED']] ] },
      { id: 'afterTakeoff', title: ['Dopo il decollo', 'After takeoff'], phase: 'climb', items: [
        [['Carrello', 'Landing gear'], ['SU', 'UP']], ['Flaps', ['RETRATTI', 'RETRACTED']], ['Packs', 'ON'], [['Altimetri', 'Altimeters'], ['STD (sopra quota di transizione)', 'STD (above transition altitude)']],
        [['Luci di atterraggio', 'Landing lights'], ['OFF (sopra FL100)', 'OFF (above FL100)']] ] },
      { id: 'cruise', title: ['Crociera', 'Cruise'], phase: 'cruise', items: [
        [['Carburante', 'Fuel'], ['CONTROLLATO vs OFP', 'CHECKED vs OFP']], [['Stato ECAM', 'ECAM status'], ['CONTROLLATO', 'CHECKED']], [['Meteo destinazione / ATIS', 'Destination weather / ATIS'], ['ASCOLTATO', 'OBTAINED']] ] },
      { id: 'descent', title: ['Preparazione discesa', 'Descent preparation'], phase: 'descent', items: [
        [['Prestazioni di atterraggio', 'Landing performance'], ['CALCOLATE', 'COMPUTED']], [['Arrivo e avvicinamento nell\'MCDU', 'Arrival and approach in the MCDU'], ['INSERITI', 'ENTERED']], [['Minimi', 'Minimums'], ['IMPOSTATI', 'SET']],
        ['Autobrake', ['IMPOSTATO', 'SET']], [['Briefing di avvicinamento', 'Approach briefing'], ['COMPLETATO', 'COMPLETED']] ] },
      { id: 'approach', title: ['Avvicinamento', 'Approach'], phase: 'approach', items: [
        [['Altimetri', 'Altimeters'], ['QNH IMPOSTATO', 'QNH SET']], [['Segnali cinture', 'Seat belts'], 'ON'], [['Minimi', 'Minimums'], ['CONTROLLATI', 'CHECKED']], [['Luci di atterraggio', 'Landing lights'], ['ON (sotto FL100)', 'ON (below FL100)']] ] },
      { id: 'landing', title: ['Atterraggio', 'Landing'], phase: 'approach', items: [
        [['Cabina', 'Cabin'], ['PRONTA', 'READY']], [['Carrello', 'Landing gear'], ['GIÙ, 3 VERDI', 'DOWN, 3 GREEN']], ['Spoilers', ['ARMATI', 'ARMED']], ['Flaps', ['CONFIGURAZIONE DI ATTERRAGGIO', 'LANDING CONFIG']],
        [['Memo di atterraggio', 'Landing memo'], ['NESSUNA VOCE BLU', 'NO BLUE']] ] },
      { id: 'afterLanding', title: ['Dopo l\'atterraggio', 'After landing'], phase: 'landed', items: [
        ['Spoilers', ['DISARMATI', 'DISARMED']], ['Flaps', ['RETRATTI', 'RETRACTED']], [['Strobo e luci di atterraggio', 'Strobes and landing lights'], 'OFF'], [['Radar meteo', 'Weather radar'], 'OFF'], ['APU', ['AVVIATA', 'STARTED']] ] },
      { id: 'parking', title: ['Parcheggio', 'Parking'], phase: 'arrived', items: [
        [['Freno di parcheggio', 'Parking brake'], ['TIRATO', 'SET']], [['Motori', 'Engines'], ['SPENTI', 'OFF']], ['Beacon', 'OFF'], [['Segnali cinture', 'Seat belts'], 'OFF'], [['Pompe carburante', 'Fuel pumps'], 'OFF'] ] },
    ],
    B737: [
      { id: 'prep', title: 'Preflight', phase: 'parked', items: [
        [['Ossigeno', 'Oxygen'], ['TESTATO, 100%', 'TESTED, 100%']], ['IRS', 'NAV'], [['Riscaldamento finestrini', 'Window heat'], 'ON'], [['Pressurizzazione', 'Pressurization'], 'AUTO'],
        [['CDU (rotta e prestazioni)', 'CDU (route and performance)'], ['COMPLETATO', 'COMPLETED']], [['Altimetri', 'Altimeters'], ['QNH IMPOSTATO', 'QNH SET']], [['Freno di parcheggio', 'Parking brake'], ['TIRATO', 'SET']], [['Leve start motori', 'Engine start levers'], 'CUTOFF'] ] },
      { id: 'beforeStart', title: 'Before start', phase: 'parked', items: [
        [['Porta cockpit', 'Flight deck door'], ['CHIUSA E BLOCCATA', 'CLOSED AND LOCKED']], [['Carburante', 'Fuel'], ['QUANTITÀ OK, POMPE ON', 'QUANTITY OK, PUMPS ON']], [['Segnali passeggeri', 'Passenger signs'], ['IMPOSTATI', 'SET']],
        ['MCP (V2, HDG, ALT)', ['IMPOSTATO', 'SET']], [['Velocità di decollo', 'Takeoff speeds'], ['V1 VR V2 IMPOSTATE', 'V1 VR V2 SET']], [['Trim timone e alettoni', 'Rudder and aileron trim'], ['LIBERI E A 0', 'FREE AND 0']],
        [['Briefing di rullaggio e decollo', 'Taxi and takeoff briefing'], ['COMPLETATO', 'COMPLETED']], [['Luce anticollisione', 'Anti-collision light'], 'ON'] ] },
      { id: 'afterStart', title: 'Before taxi', phase: 'taxi-out', items: [
        [['Generatori', 'Generators'], 'ON'], [['Riscaldamento sonde', 'Probe heat'], 'ON'], [['Anti-ghiaccio', 'Anti-ice'], ['SE NECESSARIO', 'AS REQUIRED']], ['Isolation valve', 'AUTO'],
        ['Autobrake', 'RTO'], [['Comandi di volo', 'Flight controls'], ['CONTROLLATI', 'CHECKED']], [['Area attorno all\'aereo', 'Ground equipment'], ['LIBERA', 'CLEAR']] ] },
      { id: 'beforeTakeoff', title: 'Before takeoff', phase: 'taxi-out', items: [
        ['Flaps', ['IMPOSTATI, LUCE VERDE', 'SET, GREEN LIGHT']], [['Trim stabilizzatore', 'Stabilizer trim'], ['IMPOSTATO', 'SET']], [['Briefing di decollo', 'Takeoff briefing'], ['RIVISTO', 'REVIEWED']],
        ['Transponder', 'TA/RA'], [['Luci di atterraggio', 'Landing lights'], 'ON'] ] },
      { id: 'afterTakeoff', title: 'After takeoff', phase: 'climb', items: [
        [['Bleed motori', 'Engine bleeds'], 'ON'], ['Packs', 'AUTO'], [['Carrello', 'Landing gear'], ['SU E OFF', 'UP AND OFF']], ['Flaps', ['SU, NESSUNA LUCE', 'UP, NO LIGHTS']], [['Altimetri', 'Altimeters'], ['STD (alla transizione)', 'STD (at transition)']] ] },
      { id: 'cruise', title: ['Crociera', 'Cruise'], phase: 'cruise', items: [
        [['Carburante', 'Fuel'], ['CONTROLLATO vs OFP', 'CHECKED vs OFP']], [['Meteo destinazione / ATIS', 'Destination weather / ATIS'], ['ASCOLTATO', 'OBTAINED']] ] },
      { id: 'descent', title: 'Descent', phase: 'descent', items: [
        [['Pressurizzazione', 'Pressurization'], ['QUOTA DI ATTERRAGGIO IMPOSTATA', 'LAND ALT SET']], ['Recall', ['CONTROLLATO', 'CHECKED']], ['Autobrake', ['IMPOSTATO', 'SET']],
        [['Dati di atterraggio (VREF, minimi)', 'Landing data (VREF, minimums)'], ['IMPOSTATI', 'SET']], [['Briefing di avvicinamento', 'Approach briefing'], ['COMPLETATO', 'COMPLETED']] ] },
      { id: 'approach', title: 'Approach', phase: 'approach', items: [
        [['Altimetri', 'Altimeters'], ['QNH IMPOSTATO', 'QNH SET']], [['Luci di atterraggio', 'Landing lights'], ['ON (sotto FL100)', 'ON (below FL100)']] ] },
      { id: 'landing', title: 'Landing', phase: 'approach', items: [
        ['Engine start switches', 'CONT'], ['Speedbrake', ['ARMATO', 'ARMED']], [['Carrello', 'Landing gear'], ['GIÙ', 'DOWN']], ['Flaps', ['IMPOSTATI, LUCE VERDE', 'SET, GREEN LIGHT']] ] },
      { id: 'afterLanding', title: 'After landing', phase: 'landed', items: [
        ['Speedbrake', ['GIÙ', 'DOWN']], ['Flaps', ['SU', 'UP']], [['Riscaldamento sonde', 'Probe heat'], 'OFF'], [['Strobo e luci di atterraggio', 'Strobes and landing lights'], 'OFF'], ['APU', ['AVVIATA', 'STARTED']] ] },
      { id: 'parking', title: 'Shutdown', phase: 'arrived', items: [
        [['Freno di parcheggio', 'Parking brake'], ['TIRATO', 'SET']], [['Pompe carburante', 'Fuel pumps'], 'OFF'], [['Leve start motori', 'Engine start levers'], 'CUTOFF'], [['Segnali cinture', 'Seat belts'], 'OFF'], [['Luce anticollisione', 'Anti-collision light'], 'OFF'] ] },
    ],
  };

  root.ChecklistsData = { CHECKLISTS };
})(this);
