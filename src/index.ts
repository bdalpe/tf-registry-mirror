import express, {Router, type Request, type Response, type NextFunction} from 'express';
import morgan from 'morgan';
import {Providers, Modules} from "./registry";
import {AxiosError} from "axios";
import {Readable} from "node:stream";

const errorHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
	if (error instanceof AxiosError && error.response) {
		return res.status(error.response.status).send(error.response.data);
	}

	console.log("Exception", {error});

	if (error instanceof Error) {
		return res.status(500).send(error.message);
	} else {
		return res.sendStatus(500);
	}
}

const app = express();
app.use(morgan('tiny'));

app.get('/.well-known/terraform.json', (_, res) => {
	res.status(200).json({
		"modules.v1": "/v1/modules/"
	});
});

const routes = Router();
routes.get('/healthz', (_, res) => res.sendStatus(204));

routes.get('/providers/:hostname/:namespace/:type/index.json', async (req, res: Response, next: NextFunction) => {
	const providers = new Providers(req.params.hostname);

	try {
		const result = await providers.listVersions({namespace: req.params.namespace, type: req.params.type});
		res.status(200).json(result);
	} catch (error) {
		return next(error);
	}
});

routes.get('/providers/:hostname/:namespace/:type/:version.json', async (req, res: Response, next: NextFunction) => {
	const providers = new Providers(req.params.hostname);

	try {
		const result = await providers.listAvailableDownloads({...req.params});
		res.json(result);
	} catch (error) {
		next(error);
	}
});

routes.get('/providers/:hostname/:namespace/:type/:version/download/:os/:arch/:filename.zip', async (req, res: Response, next: NextFunction) => {
	const providers = new Providers(req.params.hostname);
	try {
		const result: Readable = await providers.getDownload({...req.params});
		res.status(200);
		result.pipe(res);
	} catch (error) {
		next(error);
	}
});

routes.get('/modules/:namespace/:name/:system/versions', async (req, res: Response, next: NextFunction) => {
	const modules = new Modules();

	try {
		const versions = await modules.listVersions({...req.params});
		res.status(200).json(versions);
	} catch (error) {
		next(error);
	}
});

routes.get('/modules/:namespace/:name/:system/:version/download', async (req, res: Response, next: NextFunction) => {
	const modules = new Modules();
	try {
		const url: string = await modules.getDownload({...req.params});

		res.header('X-Terraform-Get', url).sendStatus(204);
	} catch (error) {
		next(error);
	}
})

routes.use(errorHandler);

app.use('/v1', routes);

app.listen(8081, function (this: any) {
	console.log(`Listening on port ${this.address()?.port}`);
});
