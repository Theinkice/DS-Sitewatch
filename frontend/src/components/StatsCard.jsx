import { motion } from 'framer-motion';

const colorMap = {
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    icon: 'text-blue-600 dark:text-blue-400',
    text: 'text-blue-600 dark:text-blue-400'
  },
  green: {
    bg: 'bg-primary-100 dark:bg-primary-900/30',
    icon: 'text-primary-600 dark:text-primary-400',
    text: 'text-primary-600 dark:text-primary-400'
  },
  red: {
    bg: 'bg-danger-100 dark:bg-danger-900/30',
    icon: 'text-danger-600 dark:text-danger-400',
    text: 'text-danger-600 dark:text-danger-400'
  },
  purple: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    icon: 'text-purple-600 dark:text-purple-400',
    text: 'text-purple-600 dark:text-purple-400'
  }
};

export default function StatsCard({ icon: Icon, label, value, color = 'blue' }) {
  const colors = colorMap[color];

  return (
    <div
      className="glass-card p-5 sm:p-6 group transition-all duration-300"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
            {label}
          </p>
          <p className={`text-3xl font-bold ${colors.text}`}>
            {value}
          </p>
        </div>
        <motion.div 
          className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center border border-black/5 dark:border-white/5`}
          whileHover={{ rotate: 360 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
        >
          <Icon className={`w-7 h-7 ${colors.icon}`} />
        </motion.div>
      </div>
    </div>
  );
}
