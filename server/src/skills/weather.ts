/**
 * WeatherSkill — fetches current weather from OpenWeatherMap.
 *
 * Requires OPENWEATHER_API_KEY in the environment.  If not configured,
 * returns a friendly "not configured" message.
 */

import { BaseSkill, type SkillResult } from './base.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { ExternalServiceError } from '../errors.js';

const logger = createLogger('WeatherSkill');

// ---------------------------------------------------------------------------
// OpenWeatherMap API types (subset)
// ---------------------------------------------------------------------------

interface OWMWeatherItem {
  description: string;
  icon: string;
}

interface OWMMain {
  temp: number;
  feels_like: number;
  humidity: number;
  pressure: number;
  temp_min: number;
  temp_max: number;
}

interface OWMWind {
  speed: number;
  deg: number;
}

interface OWMClouds {
  all: number;
}

interface OWMCurrentWeather {
  name: string;
  sys: { country: string };
  weather: OWMWeatherItem[];
  main: OWMMain;
  wind: OWMWind;
  clouds: OWMClouds;
  visibility: number;
  dt: number;
}

// ---------------------------------------------------------------------------
// Skill implementation
// ---------------------------------------------------------------------------

export class WeatherSkill extends BaseSkill {
  readonly name = 'weather';
  readonly description = 'Get current weather conditions for any city.';

  getToolDefinition() {
    return {
      name: 'weather',
      description:
        'Get current weather conditions for a given city. Returns temperature, humidity, wind, and more.',
      input_schema: {
        type: 'object' as const,
        properties: {
          city: {
            type: 'string',
            description: 'The city name to look up weather for (e.g. "London", "New York").',
          },
        },
        required: ['city'],
      },
    };
  }

  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.openweathermap.org/data/2.5/weather';

  constructor() {
    super();
    this.apiKey = config.openweatherApiKey;
  }

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const city = typeof params['city'] === 'string' ? params['city'].trim() : '';

    if (!city) {
      return this.failure('Please provide a city name. Usage: /weather <city>');
    }

    if (!this.apiKey) {
      return this.failure(
        'Weather is not configured. Ask the bot administrator to add an OPENWEATHER_API_KEY.',
      );
    }

    try {
      const data = await this.fetchWeather(city);
      const formatted = this.formatWeather(data);
      return this.success(formatted, { raw: data as unknown as Record<string, unknown> });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Error fetching weather', { city, error: message });

      if (message.includes('404')) {
        return this.failure(`City "${city}" not found. Please check the spelling and try again.`);
      }

      if (err instanceof Error && !(err instanceof ExternalServiceError)) {
        throw new ExternalServiceError('OpenWeather', message, err);
      }
      return this.failure(`Could not fetch weather: ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchWeather(city: string): Promise<OWMCurrentWeather> {
    const url = new URL(this.apiUrl);
    url.searchParams.set('q', city);
    url.searchParams.set('appid', this.apiKey);
    url.searchParams.set('units', 'metric');

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenWeatherMap API returned ${response.status}: ${body}`);
    }

    return (await response.json()) as OWMCurrentWeather;
  }

  private formatWeather(data: OWMCurrentWeather): string {
    const location = `${this.escape(data.name)}, ${this.escape(data.sys.country)}`;
    const description = data.weather[0]?.description ?? 'Unknown';
    const icon = this.weatherEmoji(data.weather[0]?.icon ?? '');

    const temp = Math.round(data.main.temp);
    const feelsLike = Math.round(data.main.feels_like);
    const tempMin = Math.round(data.main.temp_min);
    const tempMax = Math.round(data.main.temp_max);
    const humidity = data.main.humidity;
    const windSpeed = Math.round(data.wind.speed * 3.6); // m/s → km/h
    const windDir = this.windDirection(data.wind.deg);
    const cloudCover = data.clouds.all;
    const visibility = data.visibility ? `${(data.visibility / 1000).toFixed(1)} km` : 'N/A';

    const lines = [
      `${icon} *Weather in ${location}*`,
      '',
      `🌡️ *Temperature:* ${temp}°C (feels like ${feelsLike}°C)`,
      `📊 *Range:* ${tempMin}°C – ${tempMax}°C`,
      `🌤️ *Conditions:* ${this.escape(this.capitalise(description))}`,
      `💧 *Humidity:* ${humidity}%`,
      `💨 *Wind:* ${windSpeed} km/h ${windDir}`,
      `☁️ *Cloud cover:* ${cloudCover}%`,
      `👁️ *Visibility:* ${visibility}`,
      '',
      `_Updated: ${new Date(data.dt * 1000).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC_`,
    ];

    return lines.join('\n');
  }

  private weatherEmoji(icon: string): string {
    const map: Record<string, string> = {
      '01d': '☀️', '01n': '🌙',
      '02d': '⛅', '02n': '⛅',
      '03d': '☁️', '03n': '☁️',
      '04d': '☁️', '04n': '☁️',
      '09d': '🌧️', '09n': '🌧️',
      '10d': '🌦️', '10n': '🌦️',
      '11d': '⛈️', '11n': '⛈️',
      '13d': '❄️', '13n': '❄️',
      '50d': '🌫️', '50n': '🌫️',
    };
    return map[icon] ?? '🌡️';
  }

  private windDirection(deg: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8] ?? 'N';
  }

  private capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
  }
}
