import React from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
  className?: string;
}

export default function StatsCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  className = '',
}: StatsCardProps) {
  return (
    <div className={`card p-5 flex flex-col gap-3 animate-fade-in ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-400 leading-tight">{title}</p>
        {icon && (
          <span className="text-xl leading-none flex-shrink-0">{icon}</span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-white tabular-nums leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {trend && (
          <span
            className={`text-sm font-medium mb-0.5 ${
              trend.positive ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {trend.positive ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
        )}
      </div>

      {(subtitle ?? trend?.label) && (
        <p className="text-xs text-gray-500">
          {subtitle ?? trend?.label}
        </p>
      )}
    </div>
  );
}
