/**
 * Importing this registers both providers.
 *
 * Route files import it for the side effect rather than reaching for a provider
 * directly, which is what keeps them from knowing who answers them.
 */
import "./provider-openai";
import "./provider-anthropic";
