import axios, { AxiosResponse } from 'axios';
import moment from 'moment-timezone';
import tz_lookup from 'tz-lookup';

import { degToCard, TideData } from '.';
import { DataSerializableType, MetadataSerializableType, WindspeedUnitType } from '../app/stationData';
import wmoCodes from '../app/wmoCodes.json';
import { mphToKph, mphToMetersPerSec, mphToKnots } from './UnitConversions';

export * from './Direction';
export * from './UnitConversions';
export * from './WaterLevelCalcs';

export type WindInfo = {
	baseSpeed: number;
	gustSpeed: number;
	direction: {
		degrees: number;
		cardinal: string;
	};
};

export type HourlyForecast = {
	time: string;
	temp: number;
	wind: {
		speed: number;
		direction: number;
	};
	weatherCode: number;
	precipitationChance: number;
	isDay: boolean;
};

export type DailyForecast = {
	date: string;
	minTemp: number;
	maxTemp: number;
	wind: {
		speed: number;
		direction: number;
	};
	weatherCode: number;
	precipitationChance: number;
};

export type StationInfo = {
	id: string;
	state: string;
	name: string; // city
	latLong: {
		lat: number;
		lng: number;
	};
	now: {
		airTemperature: number;
		airTemperatureApparent: number;
		cloudiness: string;
		wind: WindInfo;
		isDay: boolean;
		weatherCode: number;
		tideHistory: TideData[];
		visibility: number; // Miles
		airQuality: number; // PPM
	};
	todaySunrise: string;
	todaySunset: string;
	forecastHourly: HourlyForecast[];
	forecastDaily: DailyForecast[];
};

/**
 * Retrieve up-to-date metadata for all NOAA stations via the Tides & Currents API.
 * Filters to only stations with the `greatlakes` property, due to project scope
 * @returns an object of the form {@link MetadataSerializableType} to be saved in the Redux store.
 */
export async function retrieveCurrentStations(): Promise<MetadataSerializableType> {
	try {
		const response = await axios({
			method: 'GET',
			url: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json'
		});

		const out: MetadataSerializableType = {};
		const greatLakesStations = response.data.stations.filter((station: { [key: string]: string }) => station.greatlakes);
		greatLakesStations.forEach(
			(station: { id: string; name: string; state: string; greatlakes: boolean; lat: number; lng: number }) => {
				const cityNameSections = station.name.split(',');
				out[station.id] = {
					city: cityNameSections.length > 1 ? cityNameSections[0] : station.name, // remove extra info for better readability
					state: station.state,
					coords: {
						lat: station.lat,
						lng: station.lng
					}
				};
			}
		);

		return out;
	} catch (err: unknown) {
		console.error(`Could not retrieve station metadata. ${err}`);
		return {};
	}
}

const atmos_url = 'https://api.open-meteo.com/v1/forecast',
	marine_url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
	air_quality_url = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const atmosParams = {
	now: [
		'temperature_2m',
		'apparent_temperature',
		'is_day',
		'cloudcover',
		'visibility',
		'weather_code',
		'windspeed_10m',
		'winddirection_10m',
		'windgusts_10m'
	],
	hourly: ['temperature_2m', 'weather_code', 'precipitation_probability', 'windspeed_10m', 'winddirection_10m', 'is_day'],
	daily: [
		'temperature_2m_max',
		'temperature_2m_min',
		'weather_code',
		'precipitation_probability_max',
		'windspeed_10m_max',
		'winddirection_10m_dominant',
		'sunrise',
		'sunset'
	]
};

/**
 * Retrieve data from multiple API sources for the given list of NOAA stations
 * @param locs the list of NOAA station ids to query
 * @param locMetadata an object containing metadata for each NOAA station
 * @param windspeed_unit which unit of measurement to use for wind speed: `mph` (miles per hour),
 * `km/h` (kilometers per hour), `m/s` (meters per second), or `kn` (knots)
 * @param unit_type which set of measurement units to use for temperature (`fahrenheit` or
 * `celcius`), precipitation (`inch` or `mm`), and tide levels (`feet` or `meters`)
 * @returns an object of the form {@link DataSerializableType} to be saved in the Redux store
 */
export async function retrieveLocationData({
	locs,
	locMetadata
}: {
	locs: string[];
	locMetadata: MetadataSerializableType;
}): Promise<DataSerializableType> {
	const promisesByStation: { [id: string]: Promise<AxiosResponse[]> } = {};

	for (const id of locs) {
		const latitude = locMetadata[id].coords.lat,
			longitude = locMetadata[id].coords.lng;
		const timezone = tz_lookup(latitude, longitude);

		const locationInfoResponseAtmos = axios({
			url: atmos_url,
			method: 'GET',
			params: {
				latitude,
				longitude,
				timezone,
				current: atmosParams.now.join(','),
				hourly: atmosParams.hourly.join(','),
				daily: atmosParams.daily.join(','),
				temperature_unit: 'fahrenheit',
				windspeed_unit: 'mph',
				precipitation_unit: 'inch'
			},
			withCredentials: false
		});

		const waterLevelResponse = axios({
			url: marine_url,
			method: 'GET',
			params: {
				station: id,
				range: 24,
				product: 'water_level',
				datum: 'LWD',
				units: 'english', // feet
				time_zone: 'lst_ldt',
				format: 'json'
			}
		});

		const locationInfoResponseAQI = axios({
			url: air_quality_url,
			method: 'GET',
			params: {
				latitude,
				longitude,
				current: 'us_aqi',
				domains: 'cams_global'
			},
			withCredentials: false
		});

		promisesByStation[id] = Promise.all([locationInfoResponseAtmos, waterLevelResponse, locationInfoResponseAQI]); // concurrently send all requests
	}

	const out: DataSerializableType = {};

	for (const [id, promises] of Object.entries(promisesByStation)) {
		try {
			const responses = await promises;

			const { forecastHourly, forecastDaily } = parseForecastedData(responses[0].data);

			out[id] = {
				id,
				state: locMetadata[id].state,
				name: locMetadata[id].city,
				latLong: locMetadata[id].coords,
				now: {
					airTemperature: responses[0].data.current.temperature_2m,
					airTemperatureApparent: responses[0].data.current.apparent_temperature,
					cloudiness: responses[0].data.current.cloudcover,
					wind: {
						baseSpeed: responses[0].data.current.windspeed_10m,
						gustSpeed: responses[0].data.current.windgusts_10m,
						direction: {
							degrees: responses[0].data.current.winddirection_10m,
							cardinal: degToCard(responses[0].data.current.winddirection_10m)
						}
					},
					isDay: responses[0].data.current.is_day === 1,
					weatherCode: responses[0].data.current.weather_code,
					tideHistory: responses[1].data.data,
					visibility: responses[0].data.current.visibility,
					airQuality: responses[2].data.current.us_aqi
				},
				todaySunrise: responses[0].data.daily.sunrise[0].substring(11),
				todaySunset: responses[0].data.daily.sunset[0].substring(11),
				forecastHourly,
				forecastDaily
			};
		} catch (err: unknown) {
			console.error(`Could not retrieve station ${id} data. ${err}`);
			return {};
		}
	}

	return out;
}

/**
 * Parse hourly and daily forecast data based on the OpenMeteo API response
 * @param data the raw {@link AxiosResponse} to parse
 * @returns the parsed forecast data, split into hourly and daily objects
 */
export function parseForecastedData(data: {
	timezone: string;
	hourly: {
		time: string[];
		temperature_2m: number[];
		windspeed_10m: number[];
		winddirection_10m: number[];
		weather_code: number[];
		precipitation_probability: number[];
		is_day: (0 | 1)[];
	};
	daily: {
		time: string[];
		temperature_2m_min: number[];
		temperature_2m_max: number[];
		windspeed_10m_max: number[];
		winddirection_10m_dominant: number[];
		weather_code: number[];
		precipitation_probability_max: number[];
	};
}): {
	forecastHourly: HourlyForecast[];
	forecastDaily: DailyForecast[];
} {
	const forecastHourly: HourlyForecast[] = [];
	const hourlyData = data.hourly;
	const hourlyDataStartIndex = moment().tz(data.timezone).hour() + 1; // Don't display past data

	// parse hourly prediction data
	for (let i = hourlyDataStartIndex; i < hourlyDataStartIndex + 24; i++) {
		forecastHourly.push({
			time: moment(hourlyData.time[i]).format('ha'),
			temp: hourlyData.temperature_2m[i],
			wind: {
				speed: hourlyData.windspeed_10m[i],
				direction: hourlyData.winddirection_10m[i]
			},
			weatherCode: hourlyData.weather_code[i],
			precipitationChance: hourlyData.precipitation_probability[i],
			isDay: hourlyData.is_day[i] === 1
		});
	}

	const forecastDaily: DailyForecast[] = [];
	const dailyData = data.daily;

	// parse daily prediction data
	for (let i = 0; i < 7; i++) {
		forecastDaily.push({
			date: moment(dailyData.time[i]).format('ddd'),
			minTemp: dailyData.temperature_2m_min[i],
			maxTemp: dailyData.temperature_2m_max[i],
			wind: {
				speed: dailyData.windspeed_10m_max[i],
				direction: dailyData.winddirection_10m_dominant[i]
			},
			weatherCode: dailyData.weather_code[i],
			precipitationChance: dailyData.precipitation_probability_max[i]
		});
	}

	return { forecastHourly, forecastDaily };
}

export type WMOInfo = {
	description: string;
	image: string;
};

/**
 * Fetches the correct weather icon based on provided parameters
 * @param weatherCode the WMO weather code to look for
 * @param isDay whether the icon should be for day or night
 * @returns an <img> element containing the relevant icon
 */
export function precipitationIconByWeatherCode(weatherCode: number, isDay: boolean): WMOInfo | null {
	const weatherCodes = wmoCodes as {
		[key: string]: { day: WMOInfo; night: WMOInfo };
	};

	if (Object.keys(weatherCodes).includes(`${weatherCode}`)) {
		return {
			description: weatherCodes[weatherCode][isDay ? 'day' : 'night'].description,
			image: weatherCodes[weatherCode][isDay ? 'day' : 'night'].image
		};
	} else {
		console.error(`Invalid WMO code provided for forecast: ${weatherCode}`);
		return null;
	}
}

export function imageForWeatherCode(weatherCode: WMOInfo | null) {
	return <img className='wmo-icon' src={weatherCode !== null ? weatherCode.image : ''} alt='??' />;
}

/**
 * Convert the given wind speed (in mph) to the desired unit type
 * @param data the base wind speed, in mph
 * @param unitType the desired resulting unit to convert to
 * @returns the converted wind speed
 */
export function convertWindSpeed(data: number, unitType: WindspeedUnitType): number {
	switch (unitType) {
		case 'km/h':
			return mphToKph(data);
		case 'm/s':
			return mphToMetersPerSec(data);
		case 'kn':
			return mphToKnots(data);
		default:
			return data; // already in mph
	}
}
