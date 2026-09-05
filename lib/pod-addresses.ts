export function getPodAddresses(seatNumber: number) {
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 20) {
    throw new RangeError(
      "Pod seat number must be an integer from 1 through 20",
    );
  }

  return {
    gatewayAddress: `10.51.${seatNumber}.1`,
    podNetwork: `10.50.${seatNumber}.0/24`,
    sessionHostAddress: `10.50.${seatNumber}.20`,
  };
}
