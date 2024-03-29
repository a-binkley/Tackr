import axios, { AxiosResponse } from 'axios';
import tz_lookup from 'tz-lookup';

import { DataSerializableType, MetadataSerializableType } from '../app/stationData';
import { degToCard } from './Direction';

export * from './Direction';

export type WindInfo = {
	baseSpeed: number;
	gustSpeed: number;
	direction: {
		degrees: number;
		cardinal: string;
	};
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
		precipitation: {
			type: string;
			chance: number;
		};
		wind: WindInfo;
		isDay: boolean;
		waterTemperature?: number;
		tideHistory: {
			t: string; // datetime of record
			v: number; // ft above low water datum
		}[];
		visibility: number; // Miles
		airQuality: number; // PPM
	};
	todaySunrise: string;
	todaySunset: string;
	// forecastHourly: (BaseInfo & {
	// 	tideLevel: number;
	// })[];
	// forecastDaily: []; // TODO
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
				out[station.id] = {
					city: station.name,
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
		'precipitation',
		'cloudcover',
		'visibility',
		'windspeed_10m',
		'winddirection_10m',
		'windgusts_10m'
	],
	hourly: [
		'temperature_2m',
		'apparent_temperature',
		'precipitation',
		'precipitation_probability',
		'cloudcover',
		'visibility',
		'windspeed_10m',
		'winddirection_10m',
		'windgusts_10m',
		'uv_index',
		'is_day'
	],
	daily: [
		'temperature_2m_max',
		'temperature_2m_min',
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
 * @param temperature_unit which unit of measurement to use for temperature: `fahrenheit` or `celcius`
 * @param windspeed_unit which unit of measurement to use for wind speed: `mph` (miles per hour),
 * `km/h` (kilometers per hour), `m/s` (meters per second), or `kn` (knots)
 * @param precipitation_unit which unit of measurement to use for precipitation: `inch` or `mm`
 * @returns an object of the form {@link DataSerializableType} to be saved in the Redux store
 */
export async function retrieveLocationData(
	locs: string[],
	locMetadata: MetadataSerializableType,
	temperature_unit: 'fahrenheit' | 'celcius',
	windspeed_unit: 'mph' | 'km/h' | 'm/s' | 'kn',
	precipitation_unit: 'inch' | 'mm'
	// length_unit: 'imperial' | 'metric'
): Promise<DataSerializableType> {
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
				temperature_unit: temperature_unit === 'fahrenheit' ? temperature_unit : undefined,
				windspeed_unit: windspeed_unit.replace('/', ''),
				precipitation_unit
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
				units: 'english',
				time_zone: 'lst_ldt',
				format: 'json'
			}
		});

		const waterTempResponse = axios({
			url: marine_url,
			method: 'GET',
			params: {
				station: id,
				date: 'latest',
				product: 'water_temperature',
				units: 'english',
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

		promisesByStation[id] = Promise.all([
			locationInfoResponseAtmos,
			waterLevelResponse,
			waterTempResponse,
			locationInfoResponseAQI
		]); // concurrently send all requests
	}

	const out: DataSerializableType = {};

	for (const [id, promises] of Object.entries(promisesByStation)) {
		try {
			const responses = await promises;

			out[id] = {
				id,
				state: locMetadata[id].state,
				name: locMetadata[id].city,
				latLong: locMetadata[id].coords,
				now: {
					airTemperature: responses[0].data.current.temperature_2m,
					airTemperatureApparent: responses[0].data.current.apparent_temperature,
					cloudiness: responses[0].data.current.cloudcover,
					precipitation: {
						type: 'TODO',
						chance: responses[0].data.current.precipitation
					},
					wind: {
						baseSpeed: responses[0].data.current.windspeed_10m,
						gustSpeed: responses[0].data.current.windgusts_10m,
						direction: {
							degrees: responses[0].data.current.winddirection_10m,
							cardinal: degToCard(responses[0].data.current.winddirection_10m)
						}
					},
					isDay: responses[0].data.current.is_day === 1,
					waterTemperature: responses[2].data.data ? responses[2].data.data[0].v : undefined,
					tideHistory: responses[1].data.data,
					visibility: responses[0].data.current.visibility,
					airQuality: responses[3].data.current.us_aqi
				},
				todaySunrise: responses[0].data.daily.sunrise[0],
				todaySunset: responses[0].data.daily.sunset[0]
				// forecastHourly: [], // TODO
				// forecastDaily: [], // TODO
			};
		} catch (err: unknown) {
			console.error(`Could not retrieve station ${id} data. ${err}`);
			return {};
		}
	}

	return out;
}
