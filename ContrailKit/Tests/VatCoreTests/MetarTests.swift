import Foundation
import XCTest
@testable import VatCore

final class MetarDecoderTests: XCTestCase {
    private func decode(_ raw: String, file: StaticString = #filePath, line: UInt = #line) throws -> DecodedMetar {
        try XCTUnwrap(MetarDecoder.decode(raw), file: file, line: line)
    }

    func testEuropeanCAVOK() throws {
        let m = try decode("LIRF 021350Z 25012KT CAVOK 24/14 Q1015 NOSIG")
        XCTAssertEqual(m.station, "LIRF")
        XCTAssertEqual(m.time, .init(day: 2, hour: 13, minute: 50))
        XCTAssertEqual(m.wind, .init(direction: 250, speedKt: 12))
        XCTAssertTrue(m.isCAVOK)
        XCTAssertEqual(m.visibilityMeters, 10_000)
        XCTAssertEqual(m.temperatureC, 24)
        XCTAssertEqual(m.dewpointC, 14)
        XCTAssertEqual(m.qnhHpa, 1015)
        XCTAssertEqual(m.altimeterInHg ?? 0, 29.97, accuracy: 0.01)
        XCTAssertEqual(m.trend, "NOSIG")
        XCTAssertEqual(m.flightCategory, .vfr)
        XCTAssertTrue(m.unparsed.isEmpty)
    }

    func testUSWithStatuteMilesAndAltimeter() throws {
        let m = try decode("KJFK 021351Z 31015G25KT 10SM FEW050 SCT250 18/06 A2992 RMK AO2 SLP132 T01830056")
        XCTAssertEqual(m.wind?.gustKt, 25)
        XCTAssertEqual(m.visibility?.statuteMiles, 10)
        XCTAssertEqual(m.visibilityMeters ?? 0, 16_093, accuracy: 1)
        XCTAssertEqual(m.clouds, [.init(cover: .few, baseFt: 5000), .init(cover: .scattered, baseFt: 25000)])
        XCTAssertEqual(m.altimeterInHg, 29.92)
        XCTAssertEqual(m.qnhHpa, 1013)
        XCTAssertEqual(m.remarks, "AO2 SLP132 T01830056")
        XCTAssertNil(m.trend)
        XCTAssertEqual(m.flightCategory, .vfr)
    }

    func testAutoVariationRainAndTempo() throws {
        let m = try decode("METAR EGLL 021350Z AUTO 24008KT 210V280 9999 -RA BKN030 OVC045 12/09 Q1008 TEMPO 4000 RA=")
        XCTAssertTrue(m.isAuto)
        XCTAssertEqual(m.wind?.variableFrom, 210)
        XCTAssertEqual(m.wind?.variableTo, 280)
        XCTAssertEqual(m.visibility?.isAtLeast, true)
        XCTAssertEqual(m.weather, [.init(intensity: .light, phenomena: ["RA"], raw: "-RA")])
        XCTAssertEqual(m.ceilingFt, 3000)
        XCTAssertEqual(m.trend, "TEMPO 4000 RA")
        XCTAssertEqual(m.flightCategory, .mvfr)
    }

    func testFogRVRAndVerticalVisibility() throws {
        let m = try decode("EDDF 021350Z 00000KT 0400 R25R/0600N R25L/0550V0700U FG VV002 08/08 Q1021 BECMG 1500 BR")
        XCTAssertEqual(m.wind?.isCalm, true)
        XCTAssertEqual(m.visibilityMeters, 400)
        XCTAssertEqual(m.runwayVisualRanges.count, 2)
        XCTAssertEqual(m.runwayVisualRanges[0], .init(runway: "25R", value: 600, trend: "N"))
        XCTAssertEqual(m.runwayVisualRanges[1], .init(runway: "25L", value: 550, maxValue: 700, trend: "U"))
        XCTAssertEqual(m.weather.first?.phenomena, ["FG"])
        XCTAssertEqual(m.clouds, [.init(cover: .verticalVisibility, baseFt: 200)])
        XCTAssertEqual(m.flightCategory, .lifr)
        XCTAssertEqual(m.relativeHumidity ?? 0, 100, accuracy: 0.01)
        XCTAssertEqual(m.trend, "BECMG 1500 BR")
    }

    func testFractionalStatuteMiles() throws {
        let m = try decode("KSFO 021356Z 28018KT 1 1/2SM BR OVC006 14/13 A2988")
        XCTAssertEqual(m.visibility?.statuteMiles, 1.5)
        XCTAssertEqual(m.weather.first?.phenomena, ["BR"])
        XCTAssertEqual(m.ceilingFt, 600)
        XCTAssertEqual(m.flightCategory, .ifr)
        XCTAssertEqual(m.qnhHpa, 1012)
    }

    func testMetersPerSecondNegativeTemperaturesAndCB() throws {
        let m = try decode("UUEE 021400Z 34005MPS 9999 -SHSN BKN015CB M05/M08 Q1002 NOSIG")
        XCTAssertEqual(m.wind?.speedKt, 10)
        XCTAssertEqual(m.weather, [.init(intensity: .light, descriptor: "SH", phenomena: ["SN"], raw: "-SHSN")])
        XCTAssertEqual(m.clouds.first, .init(cover: .broken, baseFt: 1500, type: "CB"))
        XCTAssertEqual(m.temperatureC, -5)
        XCTAssertEqual(m.dewpointC, -8)
        XCTAssertEqual(m.flightCategory, .mvfr)
    }

    func testVariableWindAndNSC() throws {
        let m = try decode("LIMC 021350Z VRB03KT 6000 NSC 22/16 Q1012")
        XCTAssertNil(m.wind?.direction)
        XCTAssertEqual(m.wind?.isVariable, true)
        XCTAssertEqual(m.visibilityMeters, 6000)
        XCTAssertEqual(m.clouds, [.init(cover: .noSignificant)])
        XCTAssertEqual(m.flightCategory, .mvfr) // 6000 m ≈ 3.7 SM (FAA: MVFR is 3–5 SM)
    }

    func testThunderstormP6SM() throws {
        let m = try decode("KDEN 021353Z 33012KT P6SM -TSRA SCT080CB BKN120 22/10 A3012")
        XCTAssertEqual(m.visibility?.isAtLeast, true)
        XCTAssertEqual(m.visibility?.statuteMiles, 6)
        XCTAssertEqual(m.weather.first, .init(intensity: .light, descriptor: "TS", phenomena: ["RA"], raw: "-TSRA"))
        XCTAssertEqual(m.clouds.first?.type, "CB")
        XCTAssertEqual(m.flightCategory, .vfr)
        XCTAssertEqual(m.qnhHpa, 1020)
    }

    func testHeavyThunderstormHailTCU() throws {
        let m = try decode("LFPG 021400Z 18015KT 2500 +TSRAGR FEW015 BKN025TCU 15/14 Q1004")
        XCTAssertEqual(m.weather.first, .init(intensity: .heavy, descriptor: "TS", phenomena: ["RA", "GR"], raw: "+TSRAGR"))
        XCTAssertEqual(m.clouds.last?.type, "TCU")
        XCTAssertEqual(m.flightCategory, .ifr)
    }

    func testFreezingFogQuarterMile() throws {
        let m = try decode("CYYZ 021400Z 05010KT 1/4SM FZFG VV001 M02/M02 A3001")
        XCTAssertEqual(m.visibility?.statuteMiles, 0.25)
        XCTAssertEqual(m.weather.first?.descriptor, "FZ")
        XCTAssertEqual(m.flightCategory, .lifr)
    }

    func testNCDAndLessThanVisibility() throws {
        let ncd = try decode("ENGM 021350Z 01004KT 9999 NCD M01/M03 Q1030")
        XCTAssertEqual(ncd.clouds, [.init(cover: .noneDetected)])
        let ord = try decode("SPECI KORD 021351Z 27010KT M1/4SM +SN FZFG OVC002 M10/M11 A2970 RMK AO2")
        XCTAssertEqual(ord.visibility?.isLessThan, true)
        XCTAssertEqual(ord.weather.count, 2)
        XCTAssertEqual(ord.weather[0].intensity, .heavy)
        XCTAssertEqual(ord.flightCategory, .lifr)
    }

    func testVicinityShowersAndDust() throws {
        let m = try decode("OMDB 021400Z 33006KT 4000 DU VCSH NSC 38/12 Q1005")
        XCTAssertEqual(m.weather.map(\.raw), ["DU", "VCSH"])
        XCTAssertEqual(m.weather[1].intensity, .vicinity)
        XCTAssertEqual(m.weather[1].descriptor, "SH")
        XCTAssertEqual(m.flightCategory, .ifr) // 4000 m ≈ 2.5 SM
        XCTAssertEqual(m.relativeHumidity ?? 0, 21, accuracy: 1.5)
    }

    func testMinimumVisibilityWithDirectionAndMissingDewpoint() throws {
        let m = try decode("LEMD 021400Z 36010KT 3000 1500SW BR SCT005 BKN010 15/ Q1018")
        XCTAssertEqual(m.visibilityMeters, 3000)
        XCTAssertEqual(m.temperatureC, 15)
        XCTAssertNil(m.dewpointC)
        XCTAssertEqual(m.flightCategory, .ifr)
    }

    func testObservationDate() throws {
        let reference = try XCTUnwrap(FastISO8601.parse("2026-10-01T00:20:00Z"))
        let lastMonth = DecodedMetar.ObservationTime(day: 30, hour: 23, minute: 50).date(relativeTo: reference)
        XCTAssertEqual(lastMonth.map(FastISO8601.string(from:)), "2026-09-30T23:50:00Z")
        let today = DecodedMetar.ObservationTime(day: 1, hour: 0, minute: 0).date(relativeTo: reference)
        XCTAssertEqual(today.map(FastISO8601.string(from:)), "2026-10-01T00:00:00Z")
    }

    func testGarbage() {
        XCTAssertNil(MetarDecoder.decode(""))
        XCTAssertNil(MetarDecoder.decode("123 nothing here"))
        let partial = MetarDecoder.decode("LIRF XYZ 25012KT")
        XCTAssertEqual(partial?.wind?.speedKt, 12)
        XCTAssertEqual(partial?.unparsed, ["XYZ"])
        XCTAssertNil(partial?.flightCategory)
    }
}

final class MetarDescriberTests: XCTestCase {
    func testEnglish() throws {
        let m = try XCTUnwrap(MetarDecoder.decode("KJFK 021351Z 27015G25KT 240V300 10SM -RA BKN030 18/12 A2992"))
        let lines = MetarDescriber.describe(m, language: .english)
        XCTAssertEqual(lines, [
            "Wind from 270° at 15 kt, gusting 25 kt, varying between 240° and 300°",
            "Visibility 10 statute miles",
            "Light rain",
            "Broken clouds at 3,000 ft",
            "Temperature 18 °C, dew point 12 °C",
            "Relative humidity 68%",
            "QNH 1013 hPa (29.92 inHg)",
            "Flight category: MVFR",
        ])
    }

    func testItalian() throws {
        let m = try XCTUnwrap(MetarDecoder.decode("LIRF 021350Z 27015G25KT 9999 +TSRA FEW020CB BKN030 18/12 Q1013 NOSIG"))
        let lines = MetarDescriber.describe(m, language: .italian)
        XCTAssertEqual(lines, [
            "Vento da 270° a 15 nodi, raffiche 25 nodi",
            "Visibilità 10 km o più",
            "Temporale con pioggia forte",
            "Poche nubi a 2.000 ft (cumulonembi)",
            "Nubi frammentate a 3.000 ft",
            "Temperatura 18 °C, punto di rugiada 12 °C",
            "Umidità relativa 68%",
            "QNH 1013 hPa (29.91 inHg)",
            "Nessun cambiamento significativo previsto",
            "Categoria di volo: MVFR",
        ])
    }

    func testEnglishCAVOKCalmAndTrend() {
        let lines = MetarDescriber.describe(raw: "EDDM 021350Z AUTO 00000KT CAVOK M02/M05 Q1030 TEMPO 0800 FG", language: .english)
        XCTAssertEqual(lines.first, "Automated observation")
        XCTAssertTrue(lines.contains("Wind calm"))
        XCTAssertTrue(lines.contains("Ceiling and visibility OK (CAVOK)"))
        XCTAssertTrue(lines.contains("Temperature -2 °C, dew point -5 °C"))
        XCTAssertTrue(lines.contains("Trend: TEMPO 0800 FG"))
        XCTAssertEqual(lines.last, "Flight category: VFR")
    }

    func testPhenomenaPhrasingBothLanguages() {
        func en(_ code: String) -> String {
            MetarDescriber.describeWeather(MetarDecoder.parseWeather(code)!, language: .english)
        }
        func it(_ code: String) -> String {
            MetarDescriber.describeWeather(MetarDecoder.parseWeather(code)!, language: .italian)
        }
        XCTAssertEqual(en("-RA"), "Light rain")
        XCTAssertEqual(it("-RA"), "Pioggia debole")
        XCTAssertEqual(en("+SHSN"), "Heavy snow showers")
        XCTAssertEqual(it("+SHSN"), "Rovesci di neve forte")
        XCTAssertEqual(en("FZFG"), "Freezing fog")
        XCTAssertEqual(it("FZFG"), "Nebbia congelantesi")
        XCTAssertEqual(en("BCFG"), "Patches of fog")
        XCTAssertEqual(it("BCFG"), "Banchi di nebbia")
        XCTAssertEqual(en("MIFG"), "Shallow fog")
        XCTAssertEqual(it("MIFG"), "Nebbia bassa")
        XCTAssertEqual(en("BLSN"), "Blowing snow")
        XCTAssertEqual(it("BLSN"), "Neve sollevata dal vento")
        XCTAssertEqual(en("DRSA"), "Low drifting sand")
        XCTAssertEqual(en("PRFG"), "Partial fog")
        XCTAssertEqual(en("VCTS"), "Thunderstorm in the vicinity")
        XCTAssertEqual(it("VCTS"), "Temporale nelle vicinanze")
        XCTAssertEqual(en("VCSH"), "Showers in the vicinity")
        XCTAssertEqual(it("VCSH"), "Rovesci nelle vicinanze")
        XCTAssertEqual(en("RASN"), "Rain and snow")
        XCTAssertEqual(it("RASN"), "Pioggia e neve")
        XCTAssertEqual(en("+TSRAGR"), "Heavy thunderstorm with rain and hail")
        XCTAssertEqual(en("GS"), "Small hail")
        XCTAssertEqual(en("PL"), "Ice pellets")
        XCTAssertEqual(en("IC"), "Ice crystals")
        XCTAssertEqual(en("UP"), "Unknown precipitation")
        XCTAssertEqual(en("DZ"), "Drizzle")
        XCTAssertEqual(it("DZ"), "Pioviggine")
        XCTAssertEqual(en("BR"), "Mist")
        XCTAssertEqual(it("BR"), "Foschia")
        XCTAssertEqual(en("FU"), "Smoke")
        XCTAssertEqual(en("HZ"), "Haze")
        XCTAssertEqual(it("HZ"), "Caligine")
        XCTAssertEqual(en("VA"), "Volcanic ash")
        XCTAssertEqual(it("VA"), "Cenere vulcanica")
        XCTAssertEqual(en("PO"), "Dust whirls")
        XCTAssertEqual(en("SQ"), "Squalls")
        XCTAssertEqual(it("SQ"), "Groppi")
        XCTAssertEqual(en("+FC"), "Heavy funnel cloud")
        XCTAssertEqual(en("SS"), "Sandstorm")
        XCTAssertEqual(it("DS"), "Tempesta di polvere")
        XCTAssertEqual(en("SA"), "Sand")
        XCTAssertEqual(en("DU"), "Widespread dust")
        XCTAssertEqual(it("GR"), "Grandine")
        XCTAssertEqual(it("+TSRAGR"), "Temporale con pioggia e grandine forte")
        // Every code has a name in both languages.
        for code in MetarDecoder.phenomenaCodes {
            XCTAssertNotNil(MetarDescriber.englishPhenomena[code], code)
            XCTAssertNotNil(MetarDescriber.italianPhenomena[code], code)
        }
    }

    func testVisibilityAndCloudPhrases() {
        XCTAssertEqual(MetarDescriber.describeVisibility(.init(meters: 800), language: .english), "Visibility 800 m")
        XCTAssertEqual(MetarDescriber.describeVisibility(.init(meters: 6000), language: .italian), "Visibilità 6 km")
        XCTAssertEqual(MetarDescriber.describeVisibility(.init(meters: 2414, statuteMiles: 1.5), language: .english),
                       "Visibility 1 1/2 statute miles")
        XCTAssertEqual(MetarDescriber.describeVisibility(.init(meters: 9656, isAtLeast: true, statuteMiles: 6), language: .english),
                       "Visibility more than 6 statute miles")
        XCTAssertEqual(MetarDescriber.describeCloud(.init(cover: .overcast, baseFt: 12000), language: .english), "Overcast at 12,000 ft")
        XCTAssertEqual(MetarDescriber.describeCloud(.init(cover: .scattered, baseFt: 4000, type: "TCU"), language: .italian),
                       "Nubi sparse a 4.000 ft (cumuli torreggianti)")
        XCTAssertEqual(MetarDescriber.describeCloud(.init(cover: .verticalVisibility, baseFt: 200), language: .english),
                       "Sky obscured, vertical visibility 200 ft")
        XCTAssertEqual(MetarDescriber.describeCloud(.init(cover: .skyClear), language: .italian), "Cielo sereno")
        XCTAssertEqual(MetarLanguage(languageCode: "it-IT"), .italian)
        XCTAssertEqual(MetarLanguage(languageCode: "en"), .english)
    }
}
