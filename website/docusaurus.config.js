// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Tutorials',
  tagline: 'A collection of tutorials',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://acchapm1.github.io',
  baseUrl: '/tutorials/',

  organizationName: 'acchapm1',
  projectName: 'tutorials',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // .md files are parsed as plain CommonMark (lenient); .mdx as MDX.
  // Without this, characters like `<` in regular markdown trigger MDX errors.
  markdown: {
    format: 'detect',
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: '..',
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          include: ['**/*.md', '**/*.mdx'],
          exclude: [
            'website/**',
            'node_modules/**',
            'tocreate/**',
            '.claude/**',
            '.git/**',
            'README.md',
          ],
          editUrl: 'https://github.com/acchapm1/tutorials/tree/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Tutorials',
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'All Tutorials',
          },
          {
            href: 'https://github.com/acchapm1/tutorials',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        copyright: `Copyright © ${new Date().getFullYear()} acchapm1. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'docker', 'yaml', 'toml', 'ini', 'json'],
      },
    }),
};

export default config;
