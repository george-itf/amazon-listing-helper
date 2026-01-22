/**
 * Circuit Breaker Module
 *
 * Protects against cascading failures from external API calls.
 * Per REPO_REVIEW_REPORT C.1 - Circuit breaker for external APIs.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failing fast, requests rejected immediately
 * - HALF_OPEN: Testing if service recovered
 *
 * @module CircuitBreaker
 */

// Circuit breaker states
const STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

// Default configuration
const DEFAULT_CONFIG = {
  failureThreshold: 5,     // Failures before opening
  successThreshold: 2,     // Successes in half-open before closing
  timeout: 30000,          // Time in open state before half-open (ms)
  halfOpenRequestLimit: 3, // Max concurrent requests in half-open
};

// In-memory circuit breakers per service
const circuits = new Map();

/**
 * Create or get a circuit breaker for a service
 * @param {string} serviceName - Unique service identifier
 * @param {Object} config - Optional configuration overrides
 * @returns {Object} Circuit breaker instance
 */
export function getCircuitBreaker(serviceName, config = {}) {
  if (!circuits.has(serviceName)) {
    circuits.set(serviceName, createCircuit(serviceName, { ...DEFAULT_CONFIG, ...config }));
  }
  return circuits.get(serviceName);
}

/**
 * Create a new circuit breaker instance
 * @private
 */
function createCircuit(serviceName, config) {
  const state = {
    name: serviceName,
    status: STATE.CLOSED,
    failures: 0,
    successes: 0,
    lastFailureTime: null,
    halfOpenRequests: 0,
    config,
  };

  return {
    /**
     * Execute a function with circuit breaker protection
     * @param {Function} fn - Async function to execute
     * @returns {Promise<any>}
     */
    async execute(fn) {
      // Check if circuit should transition from OPEN to HALF_OPEN
      if (state.status === STATE.OPEN) {
        const timeSinceFailure = Date.now() - state.lastFailureTime;
        if (timeSinceFailure >= config.timeout) {
          console.log(`[CircuitBreaker] ${serviceName}: OPEN -> HALF_OPEN (timeout elapsed)`);
          state.status = STATE.HALF_OPEN;
          state.halfOpenRequests = 0;
          state.successes = 0;
        } else {
          // Still in open state - fail fast
          const error = new Error(`Circuit breaker OPEN for ${serviceName}`);
          error.code = 'CIRCUIT_OPEN';
          error.retryable = true;
          error.retryAfter = Math.ceil((config.timeout - timeSinceFailure) / 1000);
          throw error;
        }
      }

      // In HALF_OPEN, limit concurrent requests
      if (state.status === STATE.HALF_OPEN) {
        if (state.halfOpenRequests >= config.halfOpenRequestLimit) {
          const error = new Error(`Circuit breaker HALF_OPEN limit reached for ${serviceName}`);
          error.code = 'CIRCUIT_HALF_OPEN_LIMIT';
          error.retryable = true;
          error.retryAfter = 5;
          throw error;
        }
        state.halfOpenRequests++;
      }

      try {
        const result = await fn();
        this.recordSuccess();
        return result;
      } catch (error) {
        this.recordFailure();
        throw error;
      }
    },

    /**
     * Record a successful call
     */
    recordSuccess() {
      if (state.status === STATE.HALF_OPEN) {
        state.successes++;
        state.halfOpenRequests = Math.max(0, state.halfOpenRequests - 1);
        if (state.successes >= config.successThreshold) {
          console.log(`[CircuitBreaker] ${serviceName}: HALF_OPEN -> CLOSED (recovery)`);
          state.status = STATE.CLOSED;
          state.failures = 0;
          state.successes = 0;
        }
      } else {
        // Reset failure count on success in CLOSED state
        state.failures = 0;
      }
    },

    /**
     * Record a failed call
     */
    recordFailure() {
      state.failures++;
      state.lastFailureTime = Date.now();

      if (state.status === STATE.HALF_OPEN) {
        // Any failure in half-open immediately opens circuit
        console.log(`[CircuitBreaker] ${serviceName}: HALF_OPEN -> OPEN (failure during recovery)`);
        state.status = STATE.OPEN;
        state.halfOpenRequests = 0;
      } else if (state.failures >= config.failureThreshold) {
        console.log(`[CircuitBreaker] ${serviceName}: CLOSED -> OPEN (threshold reached: ${state.failures} failures)`);
        state.status = STATE.OPEN;
      }
    },

    /**
     * Get current circuit state
     */
    getState() {
      return {
        name: state.name,
        status: state.status,
        failures: state.failures,
        lastFailureTime: state.lastFailureTime,
        config: state.config,
      };
    },

    /**
     * Manually reset the circuit breaker
     */
    reset() {
      state.status = STATE.CLOSED;
      state.failures = 0;
      state.successes = 0;
      state.halfOpenRequests = 0;
      state.lastFailureTime = null;
      console.log(`[CircuitBreaker] ${serviceName}: Manually reset to CLOSED`);
    },
  };
}

/**
 * Get all circuit breaker states (for monitoring)
 * @returns {Object[]}
 */
export function getAllCircuitStates() {
  const states = [];
  for (const [name, circuit] of circuits) {
    states.push(circuit.getState());
  }
  return states;
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuits() {
  for (const [name, circuit] of circuits) {
    circuit.reset();
  }
}

export default {
  getCircuitBreaker,
  getAllCircuitStates,
  resetAllCircuits,
  STATE,
};
