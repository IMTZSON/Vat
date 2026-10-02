import Foundation

/// Output language of ``MetarDescriber``.
public enum MetarLanguage: String, Sendable, Hashable, CaseIterable {
    case english, italian

    /// Picks Italian for "it*" language codes, English otherwise.
    public init(languageCode: String?) {
        self = (languageCode ?? "").lowercased().hasPrefix("it") ? .italian : .english
    }
}

/// Turns a ``DecodedMetar`` into plain-language sentences (DECISIONS D-017).
public enum MetarDescriber {
    /// One sentence per element: wind, visibility, RVR, weather, clouds, temperature, QNH, trend, category.
    public static func describe(_ metar: DecodedMetar, language: MetarLanguage = .english) -> [String] {
        let it = language == .italian
        var lines: [String] = []

        if metar.isAuto { lines.append(it ? "Osservazione automatica" : "Automated observation") }

        if let wind = metar.wind { lines.append(describeWind(wind, language: language)) }

        if metar.isCAVOK {
            lines.append(it ? "Visibilità e nubi OK (CAVOK)" : "Ceiling and visibility OK (CAVOK)")
        } else if let visibility = metar.visibility {
            lines.append(describeVisibility(visibility, language: language))
        }

        for rvr in metar.runwayVisualRanges {
            let unit = rvr.inFeet ? "ft" : "m"
            var value = "\(group(rvr.value, language)) \(unit)"
            if rvr.isAbove { value = (it ? "oltre " : "more than ") + value }
            if rvr.isBelow { value = (it ? "meno di " : "less than ") + value }
            if let maxValue = rvr.maxValue {
                value = it ? "variabile tra \(group(rvr.value, language)) e \(group(maxValue, language)) \(unit)"
                    : "variable between \(group(rvr.value, language)) and \(group(maxValue, language)) \(unit)"
            }
            var sentence = it ? "Portata visuale pista \(rvr.runway): \(value)" : "Runway \(rvr.runway) visual range \(value)"
            switch rvr.trend {
            case "U": sentence += it ? ", in aumento" : ", increasing"
            case "D": sentence += it ? ", in diminuzione" : ", decreasing"
            case "N": sentence += it ? ", stazionaria" : ", no change"
            default: break
            }
            lines.append(sentence)
        }

        for phenomenon in metar.weather { lines.append(describeWeather(phenomenon, language: language)) }

        for layer in metar.clouds { lines.append(describeCloud(layer, language: language)) }

        if let t = metar.temperatureC {
            var sentence = it ? "Temperatura \(t) °C" : "Temperature \(t) °C"
            if let d = metar.dewpointC { sentence += it ? ", punto di rugiada \(d) °C" : ", dew point \(d) °C" }
            lines.append(sentence)
            if let rh = metar.relativeHumidity {
                lines.append(it ? "Umidità relativa \(Int(rh.rounded()))%" : "Relative humidity \(Int(rh.rounded()))%")
            }
        }

        if let hpa = metar.qnhHpa {
            let inHg = metar.altimeterInHg ?? Double(hpa) / 33.8639
            lines.append("QNH \(hpa) hPa (\(String(format: "%.2f", inHg)) inHg)")
        }

        if let trend = metar.trend {
            if trend == "NOSIG" {
                lines.append(it ? "Nessun cambiamento significativo previsto" : "No significant change expected")
            } else {
                lines.append((it ? "Tendenza: " : "Trend: ") + trend)
            }
        }

        if let category = metar.flightCategory {
            lines.append((it ? "Categoria di volo: " : "Flight category: ") + category.rawValue)
        }
        return lines
    }

    /// Decodes and describes a raw METAR in one step (empty when undecodable).
    public static func describe(raw: String, language: MetarLanguage = .english) -> [String] {
        MetarDecoder.decode(raw).map { describe($0, language: language) } ?? []
    }

    // MARK: - Elements

    public static func describeWind(_ wind: DecodedMetar.Wind, language: MetarLanguage) -> String {
        let it = language == .italian
        let unit = it ? "nodi" : "kt"
        if wind.isCalm { return it ? "Vento calmo" : "Wind calm" }
        var sentence: String
        if let direction = wind.direction {
            let d = threeDigits(direction)
            sentence = it ? "Vento da \(d)° a \(wind.speedKt) \(unit)" : "Wind from \(d)° at \(wind.speedKt) \(unit)"
        } else {
            sentence = it ? "Vento variabile a \(wind.speedKt) \(unit)" : "Wind variable at \(wind.speedKt) \(unit)"
        }
        if let gust = wind.gustKt { sentence += it ? ", raffiche \(gust) \(unit)" : ", gusting \(gust) \(unit)" }
        if let from = wind.variableFrom, let to = wind.variableTo {
            sentence += it ? ", variabile tra \(threeDigits(from))° e \(threeDigits(to))°"
                : ", varying between \(threeDigits(from))° and \(threeDigits(to))°"
        }
        return sentence
    }

    public static func describeVisibility(_ v: DecodedMetar.Visibility, language: MetarLanguage) -> String {
        let it = language == .italian
        if let miles = v.statuteMiles {
            let value = milesString(miles)
            let unit = it ? (miles == 1 ? "miglio terrestre" : "miglia terrestri") : (miles == 1 ? "statute mile" : "statute miles")
            if v.isAtLeast { return it ? "Visibilità oltre \(value) \(unit)" : "Visibility more than \(value) \(unit)" }
            if v.isLessThan { return it ? "Visibilità inferiore a \(value) \(unit)" : "Visibility less than \(value) \(unit)" }
            return it ? "Visibilità \(value) \(unit)" : "Visibility \(value) \(unit)"
        }
        if v.meters >= 9999 { return it ? "Visibilità 10 km o più" : "Visibility 10 km or more" }
        if v.meters >= 5000 {
            let km = Int((v.meters / 1000).rounded())
            return it ? "Visibilità \(km) km" : "Visibility \(km) km"
        }
        let m = group(Int(v.meters), language)
        return it ? "Visibilità \(m) m" : "Visibility \(m) m"
    }

    public static func describeWeather(_ w: DecodedMetar.WeatherPhenomenon, language: MetarLanguage) -> String {
        language == .italian ? italianWeather(w) : englishWeather(w)
    }

    public static func describeCloud(_ layer: DecodedMetar.CloudLayer, language: MetarLanguage) -> String {
        let it = language == .italian
        let height = layer.baseFt.map { "\(group($0, language)) ft" }
        var sentence: String
        switch layer.cover {
        case .noSignificant: return it ? "Nessuna nube significativa" : "No significant clouds"
        case .noneDetected: return it ? "Nessuna nube rilevata" : "No clouds detected"
        case .skyClear, .clear: return it ? "Cielo sereno" : "Sky clear"
        case .verticalVisibility:
            return it ? "Cielo oscurato, visibilità verticale \(height ?? "sconosciuta")"
                : "Sky obscured, vertical visibility \(height ?? "unknown")"
        case .few: sentence = it ? "Poche nubi" : "Few clouds"
        case .scattered: sentence = it ? "Nubi sparse" : "Scattered clouds"
        case .broken: sentence = it ? "Nubi frammentate" : "Broken clouds"
        case .overcast: sentence = it ? "Cielo coperto" : "Overcast"
        }
        if let height { sentence += it ? " a \(height)" : " at \(height)" }
        switch layer.type {
        case "CB": sentence += it ? " (cumulonembi)" : " (cumulonimbus)"
        case "TCU": sentence += it ? " (cumuli torreggianti)" : " (towering cumulus)"
        default: break
        }
        return sentence
    }

    // MARK: - Weather phrasing

    static let englishPhenomena: [String: String] = [
        "DZ": "drizzle", "RA": "rain", "SN": "snow", "SG": "snow grains", "IC": "ice crystals", "PL": "ice pellets",
        "GR": "hail", "GS": "small hail", "UP": "unknown precipitation", "BR": "mist", "FG": "fog", "FU": "smoke",
        "VA": "volcanic ash", "DU": "widespread dust", "SA": "sand", "HZ": "haze", "PY": "spray",
        "PO": "dust whirls", "SQ": "squalls", "FC": "funnel cloud", "SS": "sandstorm", "DS": "duststorm",
    ]

    static let italianPhenomena: [String: String] = [
        "DZ": "pioviggine", "RA": "pioggia", "SN": "neve", "SG": "neve granulosa", "IC": "cristalli di ghiaccio",
        "PL": "granuli di ghiaccio", "GR": "grandine", "GS": "grandine piccola", "UP": "precipitazione sconosciuta",
        "BR": "foschia", "FG": "nebbia", "FU": "fumo", "VA": "cenere vulcanica", "DU": "polvere diffusa",
        "SA": "sabbia", "HZ": "caligine", "PY": "spruzzi", "PO": "mulinelli di polvere", "SQ": "groppi",
        "FC": "nube a imbuto", "SS": "tempesta di sabbia", "DS": "tempesta di polvere",
    ]

    static func list(_ codes: [String], _ names: [String: String], and: String) -> String {
        let words = codes.map { names[$0] ?? $0 }
        switch words.count {
        case 0: return ""
        case 1: return words[0]
        default: return words.dropLast().joined(separator: ", ") + " \(and) " + words[words.count - 1]
        }
    }

    static func englishWeather(_ w: DecodedMetar.WeatherPhenomenon) -> String {
        let p = list(w.phenomena, englishPhenomena, and: "and")
        var core: String
        switch w.descriptor {
        case "TS": core = p.isEmpty ? "thunderstorm" : "thunderstorm with \(p)"
        case "SH": core = p.isEmpty ? "showers" : "\(p) showers"
        case "FZ": core = "freezing \(p)"
        case "MI": core = "shallow \(p)"
        case "BC": core = "patches of \(p)"
        case "PR": core = "partial \(p)"
        case "DR": core = "low drifting \(p)"
        case "BL": core = "blowing \(p)"
        default: core = p
        }
        switch w.intensity {
        case .light: core = "light \(core)"
        case .heavy: core = "heavy \(core)"
        case .vicinity: core += " in the vicinity"
        case .moderate: break
        }
        return capitalized(core.trimmingCharacters(in: .whitespaces))
    }

    static func italianWeather(_ w: DecodedMetar.WeatherPhenomenon) -> String {
        let p = list(w.phenomena, italianPhenomena, and: "e")
        var core: String
        switch w.descriptor {
        case "TS": core = p.isEmpty ? "temporale" : "temporale con \(p)"
        case "SH": core = p.isEmpty ? "rovesci" : "rovesci di \(p)"
        case "FZ": core = "\(p) congelantesi"
        case "MI": core = "\(p) bassa"
        case "BC": core = "banchi di \(p)"
        case "PR": core = "\(p) parziale"
        case "DR": core = "\(p) sollevata a bassa quota"
        case "BL": core = "\(p) sollevata dal vento"
        default: core = p
        }
        // "debole"/"forte" are invariable in gender, so they agree with any noun.
        switch w.intensity {
        case .light: core += " debole"
        case .heavy: core += " forte"
        case .vicinity: core += " nelle vicinanze"
        case .moderate: break
        }
        return capitalized(core.trimmingCharacters(in: .whitespaces))
    }

    // MARK: - Formatting

    static func capitalized(_ s: String) -> String {
        guard let first = s.first else { return s }
        return first.uppercased() + s.dropFirst()
    }

    static func threeDigits(_ v: Int) -> String {
        let s = String(v)
        return String(repeating: "0", count: max(0, 3 - s.count)) + s
    }

    /// Thousands separator independent of the device locale: "3,000" (EN) / "3.000" (IT).
    static func group(_ value: Int, _ language: MetarLanguage) -> String {
        let separator = language == .italian ? "." : ","
        let digits = String(abs(value))
        var result = ""
        for (i, ch) in digits.enumerated() {
            if i > 0, (digits.count - i) % 3 == 0 { result += separator }
            result.append(ch)
        }
        return (value < 0 ? "-" : "") + result
    }

    static func milesString(_ miles: Double) -> String {
        let whole = Int(miles)
        let fraction = miles - Double(whole)
        let fractions: [(Double, String)] = [(0.125, "1/8"), (0.25, "1/4"), (0.375, "3/8"), (0.5, "1/2"),
                                              (0.625, "5/8"), (0.75, "3/4"), (0.875, "7/8")]
        if fraction < 0.01 { return String(whole) }
        if let match = fractions.first(where: { abs($0.0 - fraction) < 0.02 }) {
            return whole > 0 ? "\(whole) \(match.1)" : match.1
        }
        return String(format: "%.1f", miles)
    }
}
