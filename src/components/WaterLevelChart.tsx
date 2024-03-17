import { useMemo } from 'react';
import { AxisOptions, Chart } from 'react-charts';

import { TideDataFormatted, LevelsChartProps, calculateAvgForInterval } from '../functions';

import './WaterLevelChart.css';
import { useSelector } from 'react-redux';
import { GeneralUnitType } from '../app/stationData';
import { RootState } from '../pages';

export function WaterLevelChart(props: LevelsChartProps) {
	const generalUnitType = useSelector<RootState, GeneralUnitType>((state) => state.generalUnit);
	const cleanedData = calculateAvgForInterval(props);

	const primaryAxis = useMemo(
		(): AxisOptions<TideDataFormatted> => ({
			getValue: (datum) => datum.t
		}),
		[]
	);

	const secondaryAxes = useMemo(
		(): AxisOptions<TideDataFormatted>[] => [
			{
				getValue: (datum) => datum.v * (generalUnitType === 'english' ? 1 : 0.3048),
				elementType: 'line'
			}
		],
		[generalUnitType]
	);

	const data = useMemo(
		() => [
			{
				label: `Water Level (${generalUnitType === 'english' ? 'feet' : 'meters'} above LWD)`,
				data: cleanedData
			}
		],
		[generalUnitType]
	);

	return (
		<div className={`water-level-chart-wrapper water-chart-${props.isDay ? 'day' : 'night'}`}>
			<Chart
				className='water-level-chart'
				options={{
					data,
					primaryAxis,
					secondaryAxes
				}}
			/>
		</div>
	);
}
