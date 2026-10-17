/** The input behind test/fixtures/footprint_estimate.json (the hand-checked 156.8 kg case). */
export const SAMPLE_INPUTS = {
  householdSize: 4,
  electricityKwh: 200,
  lpgCylinders: 1,
  carOccupants: 2,
  travel: { car_petrol: 300, bus: 100, flight_domestic: 1000 },
};
