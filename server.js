import express from 'express';
import dotenv from 'dotenv';
import { proxyFetch, proxyStream } from './cf.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const BASE_API = process.env.BASE_API;

app.get('/', (req, res) => {
  res.json({
    status: true,
    message: "MEMEKKK"
  });
});

app.get('/v1/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) throw new Error("URL nya mana memek");

    const decodedUrl = decodeURIComponent(url);
    const { statusCode, headers, body } = await proxyStream(decodedUrl, req.headers);

    const allowHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control'
    ];

    res.status(statusCode);
    for (const key of allowHeaders) {
      if (headers[key]) {
        res.setHeader(key, headers[key]);
      }
    }

    body.pipe(res);
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.get('/v1/schedule', async (req, res) => {
  try {
    const days =['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU', 'RANDOM'];
    
    const results = await Promise.all(
      days.map(day => proxyFetch(`${BASE_API}/schedule/data?day=${day}`))
    );

    const scheduleData = {};
    days.forEach((day, index) => {
      scheduleData[day] = results[index]?.data?.movie ||[];
    });

    res.json({
      status: true,
      data: scheduleData
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.get('/v1/ongoing', async (req, res) => {
  try {
    const days =['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU', 'RANDOM'];
    
    const results = await Promise.all(
      days.map(day => proxyFetch(`${BASE_API}/schedule/data?day=${day}`))
    );

    const allMovies = results.flatMap(r => r?.data?.movie ||[]);
    
    const seen = new Set();
    const ongoingList = allMovies.filter(movie => {
      const isOngoing = movie.status === 'ONGOING';
      const isDuplicate = seen.has(movie.id);
      if (isOngoing && !isDuplicate) {
        seen.add(movie.id);
        return true;
      }
      return false;
    });

    res.json({
      status: true,
      data: ongoingList
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.get('/v1/genre', async (req, res) => {
  try {
    const { id, page = 0 } = req.query;

    if (id) {
      let url = `${BASE_API}/explore/movie?page=${page}`;

      if (Array.isArray(id)) {
        id.forEach(val => { url += `&genre_in=${val}`; });
      } else {
        url += `&genre_in=${id}`;
      }

      const data = await proxyFetch(url);
      return res.json({
        status: true,
        data: data.data?.movie ||[]
      });
    }

    const data = await proxyFetch(`${BASE_API}/explore/genre`);
    const genres = (data.data?.genre ||[]).map(({ id, name, group }) => ({
      id,
      name,
      group
    }));

    res.json({
      status: true,
      data: genres
    });

  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.get('/v1/popular', async (req, res) => {
  try {
    const { page = 0 } = req.query;
    const data = await proxyFetch(`${BASE_API}/explore/movie?sort=views&page=${page}`);
    
    res.json({
      status: true,
      data: data.data?.movie ||[]
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.get('/v1/search', async (req, res) => {
  try {
    const { q = '', page = 0 } = req.query;
    const data = await proxyFetch(`${BASE_API}/explore/movie?keyword=${encodeURIComponent(q)}&page=${page}`);
    
    res.json({
      status: true,
      data: data.data?.movie ||[]
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.get('/v1/detail', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) throw new Error("ID nya mana memek");

    const detailRes = await proxyFetch(`${BASE_API}/movie/detail/${id}`);

    let allEpisodes =[];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const episodesRes = await proxyFetch(`${BASE_API}/movie/episode/${id}?page=${page}`);
      const eps = episodesRes.data?.episode ||[];

      if (eps.length > 0) {
        allEpisodes = [...allEpisodes, ...eps];
        page++;
      } else {
        hasMore = false;
      }
    }

    res.json({
      status: true,
      data: {
        ...detailRes.data?.movie,
        episode_list: allEpisodes
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.get('/v1/episode', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) throw new Error("ID episode nya mana memek");

    const data = await proxyFetch(`${BASE_API}/episode/streamnew/${id}`);

    res.json({
      status: true,
      data: {
        episode: data.data?.episode || {},
        server: data.data?.server ||[],
        next_episode: data.data?.episode_next || null
      }
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    status: false,
    message: "memek elaina wangyy"
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});