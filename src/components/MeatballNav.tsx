import { useDispatch, useSelector } from 'react-redux';

import { updateViewingIndex } from '../app/stationData';
import { RootState } from '../pages';

import './MeatballNav.css';

/**
 * Meatball-style navigator which both displays the current viewing index among a user's favorite stations
 * and allows the user to jump to specific pages by clicking on any of the meatballs
 */
export function MeatballNav() {
	const favoritesIDs = useSelector<RootState, string[]>((state) => state.favoritesIDs);
	const viewingIndex = useSelector<RootState, number>((state) => state.viewingIndex);
	const dispatch = useDispatch();

	return (
		<div className='meatball-nav-wrapper'>
			{favoritesIDs.map((_: string, index: number) => {
				if (index === viewingIndex) {
					return <div key={`meatball-${index}`} className='meatball meatball-active' />;
				} else {
					return (
						<div
							key={`meatball-${index}`}
							className='meatball'
							onClick={() => dispatch(updateViewingIndex(index - viewingIndex))}
						/>
					);
				}
			})}
		</div>
	);
}
