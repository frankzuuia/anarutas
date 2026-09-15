export const maximumFleetRoutingRequests = 2;

export function fleetRoutingRequestAllowed(requests: number) {
  return requests < maximumFleetRoutingRequests;
}
