import PerfectScrollbar from 'react-perfect-scrollbar';
import { useSelector } from 'react-redux';

import { GeneralUnitType, WindspeedUnitType } from '../../app/stationData';
import { HourlyForecast, convertWindSpeed, imageForWeatherCode, precipitationIconByWeatherCode } from '../../functions';
import { RootState } from '../../pages';

import 'react-perfect-scrollbar/dist/css/styles.css';
import './HourlyForecastDisplay.css';

/**
 * Presentational component which displays hourly forecast data for the next 24 hours at a location
 * @param props.data an array of {@link HourlyForecast} objects to use for rendering various information
 */
export function HourlyForecastDisplay(props: { data: HourlyForecast[] }) {
	const generalUnitType = useSelector<RootState, GeneralUnitType>((state) => state.generalUnit);
	const windspeedUnitType = useSelector<RootState, WindspeedUnitType>((state) => state.windspeedUnit);

	const tempUnit = generalUnitType === 'english' ? '°F' : '°C';

	return (
		<div className='hourly-forecast-wrapper unselectable floating-window'>
			<PerfectScrollbar>
				{props.data.map((forecastDatum) => (
					<div className='hourly-forecast-datum-wrapper' key={`hourly-forecast-datum-${forecastDatum.time}`}>
						<p className='hourly-forecast-datum-label'>{forecastDatum.time}</p>
						<p className='hourly-forecast-datum-temp'>{`${Math.round(forecastDatum.temp)} ${tempUnit}`}</p>
						<div className='hourly-forecast-datum-weather-icon-wrapper'>
							{imageForWeatherCode(precipitationIconByWeatherCode(forecastDatum.weatherCode, forecastDatum.isDay))}
						</div>
						<p className='hourly-forecast-datum-precipitation-chance'>
							{forecastDatum.precipitationChance === 0 ? '' : `${forecastDatum.precipitationChance}%`}
						</p>
						<div className='hourly-forecast-datum-wind-data-wrapper'>
							<div className='hourly-forecast-datum-wind-direction'>
								<div
									className='hourly-forecast-wind-arrow-wrapper'
									style={{
										transform: `rotate(${forecastDatum.wind.direction}deg)`
									}}
								>
									<i className='bi bi-arrow-up hourly-forecast-wind-arrow' />
								</div>
							</div>
							<p className='hourly-forecast-datum-wind-speed-number'>{`${Math.round(
								convertWindSpeed(forecastDatum.wind.speed, windspeedUnitType)
							)}`}</p>
						</div>
						<p className='hourly-forecast-datum-wind-speed-unit'>{windspeedUnitType}</p>
					</div>
				))}
			</PerfectScrollbar>
		</div>
	);
}
