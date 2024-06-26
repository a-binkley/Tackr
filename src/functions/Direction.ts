/**
 * Convert a number from degrees to the closest cardinal direction
 * @param degrees the source number in range [0,360]
 * @returns the cardinal direction which most closely matches the input
 */
export function degToCard(degrees: number): string {
	if (degrees < 0 || degrees > 360) throw new Error(`Direction provided (${degrees} degrees) is invalid`);

	const segmentSize = 11.25; // +/- window for each cardinal direction, in degrees
	const cardinalDirections = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

	return cardinalDirections[Math.floor(((degrees + segmentSize) % 360) / segmentSize / 2)];
}
