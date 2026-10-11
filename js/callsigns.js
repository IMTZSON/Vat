/* Nominativi radio (telephony) delle compagnie più comuni su VATSIM.
   Chiave: codice ICAO a 3 lettere. Puoi aggiungerne altri qui. */
(function (root) {
  'use strict';

  const AIRLINES = {
    AZA: 'Alitalia',
    ITY: 'Itarrow',
    NOS: 'Moonflower',
    RYR: 'Ryanair',
    EZY: 'Easy',
    EJU: 'Alpine',
    EZS: 'Topswiss',
    WZZ: 'Wizz Air',
    VOE: 'Volotea',
    DLH: 'Lufthansa',
    EWG: 'Eurowings',
    CFG: 'Condor',
    BAW: 'Speedbird',
    VIR: 'Virgin',
    AFR: 'Airfrans',
    KLM: 'KLM',
    IBE: 'Iberia',
    VLG: 'Vueling',
    SWR: 'Swiss',
    AUA: 'Austrian',
    BEL: 'Beeline',
    SAS: 'Scandinavian',
    FIN: 'Finnair',
    EIN: 'Shamrock',
    TAP: 'Air Portugal',
    AEE: 'Aegean',
    LOT: 'Pollot',
    THY: 'Turkish',
    PGT: 'Sunturk',
    UAE: 'Emirates',
    QTR: 'Qatari',
    ETD: 'Etihad',
    MSR: 'Egyptair',
    RAM: 'Royal Air Maroc',
    SIA: 'Singapore',
    CPA: 'Cathay',
    UAL: 'United',
    AAL: 'American',
    DAL: 'Delta',
    JBU: 'Jetblue',
    SWA: 'Southwest',
    ACA: 'Air Canada',
    FDX: 'Fedex',
    UPS: 'UPS',
    GEC: 'Lufthansa Cargo',
  };

  const api = { AIRLINES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Callsigns = api;
})(this);
