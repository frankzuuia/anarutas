export const maximumFleetRoutingRequests = 1;

export function fleetRoutingRequestAllowed(requests: number) {
  return requests < maximumFleetRoutingRequests;
}
