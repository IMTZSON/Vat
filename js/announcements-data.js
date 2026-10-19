/* Annunci PA di cabina (italiano e inglese) compilati con i dati del volo.
   Ogni annuncio ha le fasi del volo in cui va letto (vedi Geo.PHASES). */
(function (root) {
  'use strict';

  // Nome commerciale della compagnia (diverso dal nominativo radio: BAW = British Airways, non Speedbird)
  const BRANDS = {
    AZA: 'Alitalia', ITY: 'ITA Airways', NOS: 'Neos', RYR: 'Ryanair', EZY: 'easyJet', EJU: 'easyJet', EZS: 'easyJet',
    WZZ: 'Wizz Air', VOE: 'Volotea', DLH: 'Lufthansa', EWG: 'Eurowings', CFG: 'Condor', BAW: 'British Airways',
    VIR: 'Virgin Atlantic', AFR: 'Air France', KLM: 'KLM', IBE: 'Iberia', VLG: 'Vueling', SWR: 'Swiss', AUA: 'Austrian Airlines',
    BEL: 'Brussels Airlines', SAS: 'SAS', FIN: 'Finnair', EIN: 'Aer Lingus', TAP: 'TAP Air Portugal', AEE: 'Aegean Airlines',
    LOT: 'LOT Polish Airlines', THY: 'Turkish Airlines', PGT: 'Pegasus', UAE: 'Emirates', QTR: 'Qatar Airways', ETD: 'Etihad Airways',
    MSR: 'EgyptAir', RAM: 'Royal Air Maroc', SIA: 'Singapore Airlines', CPA: 'Cathay Pacific', UAL: 'United Airlines',
    AAL: 'American Airlines', DAL: 'Delta Air Lines', JBU: 'JetBlue', SWA: 'Southwest Airlines', ACA: 'Air Canada',
    TVS: 'Smartwings', TOM: 'TUI', JAF: 'TUI', NAX: 'Norwegian', NSZ: 'Norwegian', SXS: 'SunExpress', ICE: 'Icelandair',
    CTN: 'Croatia Airlines', ASL: 'Air Serbia', ROT: 'TAROM', LGL: 'Luxair', AEA: 'Air Europa', BCS: 'European Air Transport',
  };

  const AIRCRAFT = {
    A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A20N: 'Airbus A320neo', A321: 'Airbus A321', A21N: 'Airbus A321neo',
    B736: 'Boeing 737-600', B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900', B37M: 'Boeing 737 MAX 7',
    B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10',
  };

  // Meteo all'arrivo in parole semplici, dal METAR decodificato (Metar.decode)
  function weatherWords(m) {
    if (!m || !m.raw) return null;
    const r = ` ${m.raw} `;
    if (/\s[+-]?(VC)?TS/.test(r)) return { it: 'con temporali in zona', en: 'with thunderstorms in the area' };
    if (/\s[+-]?(SH|FZ)?SN/.test(r)) return { it: 'con neve', en: 'with snow' };
    if (/\s[+-]?(SH|FZ)?(RA|DZ)/.test(r)) return { it: 'con pioggia', en: 'with some rain' };
    if (/\s(MI|BC|PR)?FG\s/.test(r)) return { it: 'con nebbia', en: 'with fog' };
    if (/\s(BR|HZ)\s/.test(r)) return { it: 'con un po\' di foschia', en: 'with some mist' };
    const cov = (m.clouds || []).map((c) => c.cover);
    if (cov.includes('OVC') || cov.includes('BKN')) return { it: 'con cielo nuvoloso', en: 'with cloudy skies' };
    if (cov.includes('SCT') || cov.includes('FEW')) return { it: 'con cielo poco nuvoloso', en: 'with a few clouds' };
    if (m.cavok || m.noClouds) return { it: 'con cielo sereno', en: 'with clear skies' };
    return null;
  }

  function durIt(min) {
    const h = Math.floor(min / 60);
    const mm = Math.round(min % 60);
    if (!h) return `${mm} minuti`;
    return `${h === 1 ? 'un\'ora' : `${h} ore`}${mm ? ` e ${mm} minuti` : ''}`;
  }
  function durEn(min) {
    const h = Math.floor(min / 60);
    const mm = Math.round(min % 60);
    if (!h) return `${mm} minutes`;
    return `${h === 1 ? 'one hour' : `${h} hours`}${mm ? ` and ${mm} minutes` : ''}`;
  }

  /* raw: { callsign, airlineName, captain, depCity, arrCity, aircraft, cruiseFl, minutesTotal, minutesLeft, arrMetar }
     -> contesto con tutti i pezzi già pronti (mai vuoti) */
  function context(raw) {
    raw = raw || {};
    const cs = String(raw.callsign || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const m = cs.match(/^([A-Z]{3})(\d[A-Z0-9]{0,4})$/);
    const airline = (raw.airlineName || '').trim() || (m && BRANDS[m[1]]) || '';
    const number = m ? m[2] : cs;
    const flightIt = airline ? `volo ${airline} ${number}` : (cs ? `volo ${cs}` : 'questo volo');
    const flightEn = airline ? `${airline} flight ${number}` : (cs ? `flight ${cs}` : 'this flight');
    const wx = weatherWords(raw.arrMetar);
    const temp = raw.arrMetar && typeof raw.arrMetar.temp === 'number' ? raw.arrMetar.temp : null;
    const left = raw.minutesLeft > 0 ? Math.round(raw.minutesLeft / 5) * 5 || 5 : null;
    const total = raw.minutesTotal > 0 ? Math.round(raw.minutesTotal / 5) * 5 || 5 : null;
    return {
      airline,
      flightIt,
      flightEn,
      captainIt: raw.captain ? `il comandante ${raw.captain}` : 'il comandante',
      captainEn: raw.captain ? `Captain ${raw.captain}` : 'your captain',
      crewIt: airline ? `a nome di ${airline} e di tutto l'equipaggio` : 'a nome di tutto l\'equipaggio',
      crewEn: airline ? `on behalf of ${airline} and the whole crew` : 'on behalf of the whole crew',
      dep: raw.depCity || '',
      arr: raw.arrCity || '',
      aircraft: AIRCRAFT[String(raw.aircraft || '').toUpperCase()] || '',
      cruise: raw.cruiseFl ? Math.round(raw.cruiseFl * 100 / 1000) * 1000 : null,
      totalIt: total ? durIt(total) : null,
      totalEn: total ? durEn(total) : null,
      leftIt: left ? durIt(left) : null,
      leftEn: left ? durEn(left) : null,
      wxIt: wx ? wx.it : null,
      wxEn: wx ? wx.en : null,
      temp,
    };
  }

  const toIt = (c) => (c.arr ? ` per ${c.arr}` : '');
  const toEn = (c) => (c.arr ? ` to ${c.arr}` : '');
  const ftIt = (ft) => `${ft.toLocaleString('it-IT')} piedi`;
  const ftEn = (ft) => `${ft.toLocaleString('en-US')} feet`;
  function weatherIt(c) {
    if (!c.arr || (!c.wxIt && c.temp === null)) return '';
    return ` A ${c.arr} ci aspettano${c.temp !== null ? ` ${c.temp} gradi` : ' condizioni'}${c.wxIt ? ` ${c.wxIt}` : ''}.`;
  }
  function weatherEn(c) {
    if (!c.arr || (!c.wxEn && c.temp === null)) return '';
    return ` The weather in ${c.arr} is${c.temp !== null ? ` ${c.temp} degrees` : ''}${c.wxEn ? ` ${c.wxEn}` : ' fine'}.`;
  }

  const LIST = [
    {
      id: 'boarding', title: ['Benvenuto a bordo', 'Welcome on board'], who: ['Equipaggio', 'Cabin crew'], phases: ['parked'],
      it: (c) => `Signore e signori, buongiorno e benvenuti a bordo del ${c.flightIt}${toIt(c)}. Vi preghiamo di sistemare il bagaglio a mano nelle cappelliere o sotto il sedile davanti a voi, e di prendere posto il prima possibile per permetterci di partire in orario. Grazie.`,
      en: (c) => `Ladies and gentlemen, good day and welcome on board ${c.flightEn}${toEn(c)}. Please place your hand luggage in the overhead lockers or under the seat in front of you, and take your seat as quickly as possible so that we can depart on time. Thank you.`,
    },
    {
      id: 'doors', title: ['Porte chiuse e sicurezza', 'Doors closed and safety'], who: ['Equipaggio', 'Cabin crew'], phases: ['parked', 'taxi-out'],
      it: (c) => `Signore e signori, le porte sono state chiuse. Vi preghiamo di allacciare le cinture, portare lo schienale in posizione verticale, chiudere il tavolino e impostare i dispositivi elettronici in modalità aereo. Vi chiediamo ora qualche minuto di attenzione per le dimostrazioni di sicurezza.`,
      en: (c) => `Ladies and gentlemen, boarding is now complete and the doors are closed. Please fasten your seatbelt, bring your seat back to the upright position, stow your tray table and switch your electronic devices to flight mode. We now kindly ask for your attention for the safety demonstration.`,
    },
    {
      id: 'welcome-captain', title: ['Il comandante si presenta', 'Captain\'s welcome'], who: ['Comandante', 'Captain'], phases: ['parked', 'taxi-out'],
      it: (c) => `Signore e signori, buongiorno, vi parla ${c.captainIt}. ${c.crewIt[0].toUpperCase()}${c.crewIt.slice(1)}, benvenuti a bordo${c.aircraft ? ` di questo ${c.aircraft}` : ''}.${c.totalIt ? ` Il tempo di volo previsto${toIt(c)} è di ${c.totalIt}` : ''}${c.totalIt && c.cruise ? `, a una quota di crociera di ${ftIt(c.cruise)}` : ''}${c.totalIt ? '.' : ''}${weatherIt(c)} Mettetevi comodi e buon viaggio.`,
      en: (c) => `Ladies and gentlemen, good day, this is ${c.captainEn} speaking. ${c.crewEn[0].toUpperCase()}${c.crewEn.slice(1)}, welcome on board${c.aircraft ? ` this ${c.aircraft}` : ''}.${c.totalEn ? ` Our flight time${toEn(c)} is expected to be ${c.totalEn}` : ''}${c.totalEn && c.cruise ? `, at a cruising altitude of ${ftEn(c.cruise)}` : ''}${c.totalEn ? '.' : ''}${weatherEn(c)} Sit back, relax and enjoy the flight.`,
    },
    {
      id: 'crew-takeoff', title: ['Equipaggio, posti per il decollo', 'Cabin crew, seats for take-off'], who: ['Comandante', 'Captain'], phases: ['taxi-out'], short: true,
      it: () => 'Equipaggio di cabina, ai posti per il decollo.',
      en: () => 'Cabin crew, seats for take-off.',
    },
    {
      id: 'service', title: ['Apertura del servizio di bordo', 'Onboard service'], who: ['Equipaggio', 'Cabin crew'], phases: ['climb', 'cruise'],
      it: (c) => `Signore e signori, il comandante ha spento il segnale delle cinture, ma vi consigliamo di tenerle allacciate quando siete seduti. Tra pochi minuti passeremo con il servizio di bordo: troverete bevande calde e fredde, snack, pasti e i prodotti duty free. Accettiamo carte di credito e di debito.`,
      en: (c) => `Ladies and gentlemen, the captain has switched off the seatbelt sign, but we recommend that you keep your seatbelt fastened while seated. In a few minutes we will begin our onboard service with hot and cold drinks, snacks, meals and duty free products. We accept credit and debit cards.`,
    },
    {
      id: 'cruise', title: ['Aggiornamento in crociera', 'Cruise update'], who: ['Comandante', 'Captain'], phases: ['cruise'],
      it: (c) => `Signore e signori, vi parla ancora ${c.captainIt}.${c.cruise ? ` Stiamo volando a ${ftIt(c.cruise)}` : ' Siamo in crociera'}${c.leftIt ? ` e arriveremo${toIt(c).replace(' per', ' a')} tra circa ${c.leftIt}` : ''}.${weatherIt(c)} Vi auguro un buon proseguimento di volo.`,
      en: (c) => `Ladies and gentlemen, this is ${c.captainEn} again.${c.cruise ? ` We are now cruising at ${ftEn(c.cruise)}` : ' We are now in the cruise'}${c.leftEn ? ` and we expect to land${toEn(c).replace(' to', ' in')} in about ${c.leftEn}` : ''}.${weatherEn(c)} Enjoy the rest of the flight.`,
    },
    {
      id: 'turbulence', title: ['Turbolenza', 'Turbulence'], who: ['Comandante', 'Captain'], phases: ['climb', 'cruise', 'descent'], anytime: true,
      it: () => 'Signore e signori, stiamo attraversando una zona di turbolenza. Il segnale delle cinture è acceso: vi preghiamo di tornare al vostro posto e allacciare le cinture. I servizi igienici non sono disponibili. Equipaggio, sospendete il servizio e prendete posto.',
      en: () => 'Ladies and gentlemen, we are experiencing some turbulence. The captain has switched on the seatbelt sign: please return to your seat and fasten your seatbelt. The toilets are not available at this time. Cabin crew, please suspend the service and take your seats.',
    },
    {
      id: 'descent', title: ['Inizio della discesa', 'Start of descent'], who: ['Comandante', 'Captain'], phases: ['descent'],
      it: (c) => `Signore e signori, abbiamo iniziato la discesa${toIt(c).replace(' per', ' verso')}${c.leftIt ? ` e atterreremo tra circa ${c.leftIt}` : ''}.${weatherIt(c)} Vi preghiamo di tornare al vostro posto, allacciare le cinture e portare lo schienale in posizione verticale. Grazie per aver volato con noi.`,
      en: (c) => `Ladies and gentlemen, we have started our descent${toEn(c).replace(' to', ' into')}${c.leftEn ? ` and we expect to land in about ${c.leftEn}` : ''}.${weatherEn(c)} Please return to your seat, fasten your seatbelt and bring your seat back to the upright position. Thank you for flying with us.`,
    },
    {
      id: 'crew-landing', title: ['Equipaggio, posti per l\'atterraggio', 'Cabin crew, prepare for landing'], who: ['Comandante', 'Captain'], phases: ['approach'], short: true,
      it: () => 'Equipaggio di cabina, preparare la cabina per l\'atterraggio.',
      en: () => 'Cabin crew, prepare the cabin for landing.',
    },
    {
      id: 'arrival', title: ['Benvenuti a destinazione', 'Welcome to destination'], who: ['Equipaggio', 'Cabin crew'], phases: ['landed', 'taxi-in', 'arrived'],
      it: (c) => `Signore e signori, benvenuti${c.arr ? ` a ${c.arr}` : ' a destinazione'}${c.temp !== null ? `, dove la temperatura è di ${c.temp} gradi` : ''}. Vi preghiamo di restare seduti con le cinture allacciate fino allo spegnimento del segnale. ${c.crewIt[0].toUpperCase()}${c.crewIt.slice(1)}, grazie per aver scelto di volare con noi e arrivederci.`,
      en: (c) => `Ladies and gentlemen, welcome to ${c.arr || 'your destination'}${c.temp !== null ? `, where the temperature is ${c.temp} degrees` : ''}. Please remain seated with your seatbelt fastened until the seatbelt sign has been switched off. ${c.crewEn[0].toUpperCase()}${c.crewEn.slice(1)}, thank you for flying with us and goodbye.`,
    },
  ];

  // Tutti gli annunci compilati: [{ id, title: [it, en], who: [it, en], phases, it, en }]
  function build(raw) {
    const c = context(raw);
    return LIST.map((a) => ({ id: a.id, title: a.title, who: a.who, phases: a.phases, short: !!a.short, anytime: !!a.anytime, it: a.it(c), en: a.en(c) }));
  }

  // Annuncio da proporre per la fase del volo (il primo non ancora letto)
  function suggest(list, phase, done) {
    const d = done || {};
    const cands = list.filter((a) => a.phases.includes(phase) && !a.anytime);
    return cands.find((a) => !d[a.id]) || null;
  }

  const api = { BRANDS, AIRCRAFT, LIST, weatherWords, context, build, suggest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Announcements = api;
})(this);
